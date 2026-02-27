const ExcelJS = require('exceljs');
const GuestEntryRequest = require('../../model/guestEntryRequestSchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');
const { toISTDateLabel, toISTTimeLabel } = require('../../utils/dateTime');

const REPORT_FILTERS = Object.freeze({
  today: 'today',
  this_month: 'this_month',
  past_3_months: 'past_3_months',
});

const FILTER_TO_FILE_NAME = Object.freeze({
  [REPORT_FILTERS.today]: 'visitor-log-today.xlsx',
  [REPORT_FILTERS.this_month]: 'visitor-log-this-month.xlsx',
  [REPORT_FILTERS.past_3_months]: 'visitor-log-past-3-months.xlsx',
});

const VISITOR_TYPE_LABELS = Object.freeze({
  guest: 'Guest',
  delivery_executive: 'Delivery',
  taxi_vehicle_driver: 'Taxi',
  other_visitor: 'Other Visitor',
});

const STATUS_LABELS = Object.freeze({
  pending: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Entry Denied',
  entered: 'Inside Society',
  left: 'Left Society',
  wrong_entry: 'Wrong Entry',
  cancelled: 'Cancelled',
  expired: 'Expired',
});

const inFlightJobs = new Map();

const normalizeFilter = (value) => {
  const filter = String(value || REPORT_FILTERS.today).trim().toLowerCase();
  if (!Object.values(REPORT_FILTERS).includes(filter)) {
    throw createHttpError('Invalid filter. Allowed values: today, this_month, past_3_months.', 400);
  }
  return filter;
};

const getDateRangeForFilter = (filter) => {
  const now = new Date();
  let startDate;

  if (filter === REPORT_FILTERS.today) {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (filter === REPORT_FILTERS.this_month) {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1, 0, 0, 0, 0);
  }

  return {
    startDate,
    endDate: now,
  };
};

const getStatusLabel = (doc) => {
  if (doc.status === 'approved' && doc.approvedByGuardWithoutMemberResponse) {
    return 'Partial Approved';
  }

  return STATUS_LABELS[doc.status] || 'Awaiting Approval';
};

const getReferenceTime = (doc) =>
  doc.entryAllowedAt ||
  doc.entryLeftAt ||
  doc.approvedAt ||
  doc.rejectedAt ||
  doc.wrongEntryMarkedAt ||
  doc.createdAt ||
  null;

const formatDate = (value) => (value ? toISTDateLabel(value) || '-' : '-');
const formatTime = (value) => (value ? toISTTimeLabel(value) || '-' : '-');

const formatDeniedReason = (doc) => {
  const parts = [doc.rejectedReason, doc.rejectedDescription].map((value) => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' | ') : '-';
};

const buildReportRows = (docs = []) =>
  docs.map((doc) => {
    const visitorStatus = getStatusLabel(doc);
    const referenceTime = getReferenceTime(doc);
    const isWrongEntry = doc.status === 'wrong_entry' || doc.isWrongEntry === true;

    return {
      visitorName: doc.guestName || '-',
      visitorType: VISITOR_TYPE_LABELS[doc.visitorType] || 'Guest',
      visitorStatus,
      companyName: doc.visitorCompanyName || '-',
      subCategory: doc.visitorWorkCategory || '-',
      date: formatDate(referenceTime),
      entryTime: formatTime(doc.entryAllowedAt),
      exitTime: formatTime(doc.entryLeftAt),
      otherTime: formatTime(referenceTime),
      wing: doc.wingName || '-',
      unitNumber: doc.unitNumber || '-',
      isWrongEntry: isWrongEntry ? 'Yes' : 'No',
      wrongEntryReason: doc.wrongEntryReason || doc.wrongEntryDescription || '-',
      isEntryDenied: doc.status === 'rejected' ? 'Yes' : 'No',
      entryDeniedReason: doc.status === 'rejected' ? formatDeniedReason(doc) : '-',
      gateName: doc.gateName || '-',
    };
  });

const autosizeColumns = (worksheet) => {
  worksheet.columns.forEach((column) => {
    const lengths = [
      String(column.header || '').length,
      ...column.values.slice(1).map((value) => String(value == null ? '' : value).length),
    ];
    const maxLength = Math.max(...lengths, 10);
    column.width = Math.min(maxLength + 2, 42);
  });
};

const generateWorkbookBuffer = async ({ rows, filter, societyId }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Visitor Log');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Visitor Name', key: 'visitorName' },
    { header: 'Visitor Type', key: 'visitorType' },
    { header: 'Visitor Status', key: 'visitorStatus' },
    { header: 'Company Name', key: 'companyName' },
    { header: 'Sub Category', key: 'subCategory' },
    { header: 'Date', key: 'date' },
    { header: 'Entry Time', key: 'entryTime' },
    { header: 'Exit Time', key: 'exitTime' },
    { header: 'Other Time', key: 'otherTime' },
    { header: 'Wing', key: 'wing' },
    { header: 'Unit Number', key: 'unitNumber' },
    { header: 'Is Wrong Entry', key: 'isWrongEntry' },
    { header: 'Wrong Entry Reason', key: 'wrongEntryReason' },
    { header: 'Entry Denied', key: 'isEntryDenied' },
    { header: 'Entry Denied Reason', key: 'entryDeniedReason' },
    { header: 'Gate', key: 'gateName' },
  ];

  worksheet.getRow(1).font = { bold: true };

  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  if (rows.length === 0) {
    worksheet.addRow({
      visitorName: 'No records found',
      visitorType: '-',
      visitorStatus: '-',
      companyName: '-',
      subCategory: '-',
      date: '-',
      entryTime: '-',
      exitTime: '-',
      otherTime: '-',
      wing: '-',
      unitNumber: '-',
      isWrongEntry: '-',
      wrongEntryReason: '-',
      isEntryDenied: '-',
      entryDeniedReason: '-',
      gateName: '-',
    });
  }

  autosizeColumns(worksheet);

  workbook.properties.subject = `Visitor Log Report (${filter})`;
  workbook.properties.title = `Society ${societyId} Visitor Log`;

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const getReportObjectKey = ({ societyId, filter }) => {
  const fileName = FILTER_TO_FILE_NAME[filter] || FILTER_TO_FILE_NAME[REPORT_FILTERS.today];
  return `reports/${societyId}/${fileName}`;
};

const fetchVisitorLogs = async ({ societyId, filter }) => {
  const { startDate, endDate } = getDateRangeForFilter(filter);

  return GuestEntryRequest.find({
    societyId,
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['pending', 'approved', 'rejected', 'entered', 'left', 'wrong_entry'] },
  })
    .select({
      guestName: 1,
      visitorType: 1,
      status: 1,
      visitorCompanyName: 1,
      visitorWorkCategory: 1,
      createdAt: 1,
      entryAllowedAt: 1,
      entryLeftAt: 1,
      approvedAt: 1,
      approvedByGuardWithoutMemberResponse: 1,
      rejectedAt: 1,
      rejectedReason: 1,
      rejectedDescription: 1,
      wrongEntryMarkedAt: 1,
      wrongEntryReason: 1,
      wrongEntryDescription: 1,
      isWrongEntry: 1,
      wingName: 1,
      unitNumber: 1,
      gateName: 1,
    })
    .sort({ createdAt: -1 })
    .lean();
};

const generateAndUploadVisitorLogReport = async ({ societyId, filter = REPORT_FILTERS.today }) => {
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
    const docs = await fetchVisitorLogs({
      societyId: normalizedSocietyId,
      filter: normalizedFilter,
    });

    const rows = buildReportRows(docs);
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
  generateAndUploadVisitorLogReport,
};
