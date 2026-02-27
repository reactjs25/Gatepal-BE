const ExcelJS = require('exceljs');
const GuardDutyLog = require('../../model/guardDutyLogSchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');
const { toISTDateLabel, toISTTimeLabel } = require('../../utils/dateTime');

const REPORT_FILTERS = Object.freeze({
  today: 'today',
  this_month: 'this_month',
  past_3_months: 'past_3_months',
});

const FILTER_TO_FILE_NAME = Object.freeze({
  [REPORT_FILTERS.today]: 'guards-log-today.xlsx',
  [REPORT_FILTERS.this_month]: 'guards-log-this-month.xlsx',
  [REPORT_FILTERS.past_3_months]: 'guards-log-past-3-months.xlsx',
});

const IST_OFFSET_MINUTES = 330;
const inFlightJobs = new Map();

const toDateInIST = (value) => new Date(value.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
const fromISTToUTC = (value) => new Date(value.getTime() - IST_OFFSET_MINUTES * 60 * 1000);

const normalizeFilter = (value) => {
  const filter = String(value || REPORT_FILTERS.today).trim().toLowerCase();
  if (!Object.values(REPORT_FILTERS).includes(filter)) {
    throw createHttpError('Invalid filter. Allowed values: today, this_month, past_3_months.', 400);
  }
  return filter;
};

const getDateRangeForFilter = (filter) => {
  const nowUtc = new Date();
  const nowIst = toDateInIST(nowUtc);

  const year = nowIst.getUTCFullYear();
  const month = nowIst.getUTCMonth();
  const day = nowIst.getUTCDate();

  let startIst;

  if (filter === REPORT_FILTERS.today) {
    startIst = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  } else if (filter === REPORT_FILTERS.this_month) {
    startIst = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  } else {
    startIst = new Date(Date.UTC(year, month - 3, 1, 0, 0, 0, 0));
  }

  const endIst = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));

  return {
    startDateUtc: fromISTToUTC(startIst),
    endDateUtc: fromISTToUTC(endIst),
  };
};

const toDutyTag = (logType) => (logType === 'duty_start' ? 'Duty Start' : 'Duty End');

const buildReportRows = (logs = []) =>
  logs.map((log) => ({
    guardName: log.guardName || '-',
    date: toISTDateLabel(log.logTime) || '-',
    time: toISTTimeLabel(log.logTime) || '-',
    dutyTag: toDutyTag(log.logType),
    gateName: log.gateName || '-',
  }));

const autosizeColumns = (worksheet) => {
  worksheet.columns.forEach((column) => {
    const lengths = [
      String(column.header || '').length,
      ...column.values
        .slice(1)
        .map((value) => String(value == null ? '' : value).length),
    ];
    const maxLength = Math.max(...lengths, 10);
    column.width = Math.min(maxLength + 2, 40);
  });
};

const generateWorkbookBuffer = async ({ rows, filter, societyId }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Guards Log');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Guard Name', key: 'guardName' },
    { header: 'Date', key: 'date' },
    { header: 'Time', key: 'time' },
    { header: 'Duty Tag', key: 'dutyTag' },
    { header: 'Gate', key: 'gateName' },
  ];

  worksheet.getRow(1).font = { bold: true };

  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  if (rows.length === 0) {
    worksheet.addRow({
      guardName: 'No records found',
      date: '-',
      time: '-',
      dutyTag: '-',
      gateName: '-',
    });
  }

  autosizeColumns(worksheet);

  workbook.properties.subject = `Guards Log Report (${filter})`;
  workbook.properties.title = `Society ${societyId} Guards Log`;

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const getReportObjectKey = ({ societyId, filter }) => {
  const fileName = FILTER_TO_FILE_NAME[filter] || FILTER_TO_FILE_NAME[REPORT_FILTERS.today];
  return `reports/${societyId}/${fileName}`;
};

const fetchGuardLogs = async ({ societyId, filter }) => {
  const { startDateUtc, endDateUtc } = getDateRangeForFilter(filter);

  return GuardDutyLog.find({
    societyId,
    logTime: { $gte: startDateUtc, $lt: endDateUtc },
  })
    .select({ guardName: 1, logType: 1, logTime: 1, gateName: 1 })
    .sort({ logTime: -1 })
    .lean();
};

const generateAndUploadGuardsLogReport = async ({ societyId, filter = REPORT_FILTERS.today }) => {
  const normalizedSocietyId = String(societyId || '').trim();
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const normalizedFilter = normalizeFilter(filter);
  const lockKey = `${normalizedSocietyId}:${normalizedFilter}`;

  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const logs = await fetchGuardLogs({
      societyId: normalizedSocietyId,
      filter: normalizedFilter,
    });

    const rows = buildReportRows(logs);
    const workbookBuffer = await generateWorkbookBuffer({
      rows,
      filter: normalizedFilter,
      societyId: normalizedSocietyId,
    });

    const objectKey = getReportObjectKey({
      societyId: normalizedSocietyId,
      filter: normalizedFilter,
    });

    const reportUrl = await uploadBufferToS3ByKey({
      buffer: workbookBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      key: objectKey,
      cacheControl: 'no-store',
      contentDisposition: 'attachment',
    });

    return {
      url: reportUrl,
      key: objectKey,
      count: rows.length,
      filter: normalizedFilter,
      generatedAt: new Date().toISOString(),
    };
  })();

  inFlightJobs.set(lockKey, task);

  try {
    return await task;
  } finally {
    inFlightJobs.delete(lockKey);
  }
};

module.exports = {
  REPORT_FILTERS,
  normalizeFilter,
  generateAndUploadGuardsLogReport,
};
