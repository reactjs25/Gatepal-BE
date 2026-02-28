const ExcelJS = require('exceljs');
const Maintenance = require('../../model/maintenanceSchema');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const STATUS_LABELS = Object.freeze({
  uploaded: 'Uploaded',
  verified: 'Verified',
  rejected: 'Rejected',
  pending: 'Pending',
});

const inFlightJobs = new Map();

const normalizeString = (value) => String(value || '').trim();
const toLower = (value) => normalizeString(value).toLowerCase();

const normalizeMonth = (value) => {
  const monthRaw = normalizeString(value);
  if (!monthRaw) {
    return MONTH_LABELS[new Date().getMonth()];
  }

  const month = MONTH_LABELS.find((item) => toLower(item) === toLower(monthRaw));
  if (!month) {
    throw createHttpError('Invalid month. Use full month name like September.', 400);
  }

  return month;
};

const normalizeYear = (value) => {
  const parsed = Number(value || new Date().getFullYear());
  const year = Math.round(parsed);
  if (!Number.isFinite(year) || String(year).length !== 4) {
    throw createHttpError('year must be a 4-digit number.', 400);
  }
  return year;
};

const normalizeStatusFilter = (value) => {
  const status = toLower(value);
  if (!status) {
    throw createHttpError('status is required. Allowed values: uploaded, verified, rejected.', 400);
  }

  if (!['uploaded', 'verified', 'rejected'].includes(status)) {
    throw createHttpError('Invalid status. Allowed values: uploaded, verified, rejected.', 400);
  }

  return status;
};

const classifyUnitGroup = (items = []) => {
  const types = new Set(items.map((x) => x.occupantType));
  const statuses = new Set(items.map((x) => x.occupancyStatus));

  if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) {
    return 'tenant';
  }

  if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) {
    return 'vacant';
  }

  if (types.has('unit_owner') || types.has('unit_owner_family_member')) {
    return 'owner';
  }

  return 'owner';
};

const mapOccupancyLabel = (kind) => {
  if (kind === 'owner') return 'Owner living';
  if (kind === 'tenant') return 'Tenant living';
  return 'Vacant';
};

const normalizeMaintenanceStatus = (value) => {
  const v = toLower(value);
  if (v === 'uploaded') return 'uploaded';
  if (v === 'verified') return 'verified';
  if (v === 'rejected') return 'rejected';
  return 'pending';
};

const getUnitKey = (wingName, unitNumber) => `${toLower(wingName)}:${toLower(unitNumber)}`;

const parseUnitId = (unitId) => {
  const parts = String(unitId || '').split(':');
  return {
    wingLower: parts[1] || '',
    unitLower: parts[2] || '',
  };
};

const getStatusQueryForDb = (statusFilter) => {
  if (statusFilter === 'uploaded') {
    return { $in: ['Uploaded', 'UPLOADED'] };
  }
  if (statusFilter === 'verified') {
    return { $in: ['Verified', 'VERIFIED'] };
  }
  return { $in: ['Rejected', 'REJECTED', 'Pending', 'PENDING'] };
};

const autosizeColumns = (worksheet) => {
  worksheet.columns.forEach((column) => {
    const lengths = [
      String(column.header || '').length,
      ...column.values.slice(1).map((value) => String(value == null ? '' : value).length),
    ];
    const maxLength = Math.max(...lengths, 10);
    column.width = Math.min(maxLength + 2, 36);
  });
};

const buildWorkbookBuffer = async ({ rows, month, year, statusFilter }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Maintenance Report');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Wing Number', key: 'wingNumber' },
    { header: 'Unit Number', key: 'unitNumber' },
    { header: 'Occupancy Status', key: 'occupancyStatus' },
    { header: 'Month', key: 'month' },
    { header: 'Year', key: 'year' },
    { header: 'Status of Maintenance', key: 'maintenanceStatus' },
    { header: 'Is Rejected?', key: 'isRejected' },
    { header: 'Rejected Reason', key: 'rejectedReason' },
  ];

  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));

  if (rows.length === 0) {
    worksheet.addRow({
      wingNumber: 'No records found',
      unitNumber: '-',
      occupancyStatus: '-',
      month,
      year,
      maintenanceStatus: STATUS_LABELS[statusFilter] || '-',
      isRejected: '-',
      rejectedReason: '-',
    });
  }

  autosizeColumns(worksheet);

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const buildReportRows = async ({ societyId, month, year, statusFilter }) => {
  const society = await Society.findById(societyId).lean();
  if (!society) {
    throw createHttpError('Society not found.', 404);
  }

  const includePendingMissing = statusFilter === 'rejected';

  const maintenanceDocs = await Maintenance.find(
    {
      unitId: { $regex: `^${String(societyId)}:` },
      month,
      year,
      deletedAt: null,
      status: getStatusQueryForDb(statusFilter),
    },
    {
      unitId: 1,
      status: 1,
      rejectionReason: 1,
      rejectionDescription: 1,
      rejectedAt: 1,
    }
  ).lean();

  const maintenanceByUnitKey = new Map();
  maintenanceDocs.forEach((doc) => {
    const parsed = parseUnitId(doc.unitId);
    const key = `${parsed.wingLower}:${parsed.unitLower}`;
    maintenanceByUnitKey.set(key, doc);
  });

  const occupants = await MemberUnit.find(
    { societyId },
    {
      wingName: 1,
      wingNameLower: 1,
      unitNumber: 1,
      unitNumberLower: 1,
      occupantType: 1,
      occupancyStatus: 1,
    }
  ).lean();

  const unitGroups = occupants.reduce((acc, item) => {
    const key = `${item.wingNameLower}:${item.unitNumberLower}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const unitsFromStructure = [];
  const wings = Array.isArray(society.structure) ? society.structure : [];

  wings.forEach((wing) => {
    const wingName = wing?.wingName || '';
    const units = Array.isArray(wing?.units) ? wing.units : [];

    units.forEach((unit) => {
      const unitNumber = unit?.unitNumber || '';
      unitsFromStructure.push({ wingName, unitNumber });
    });
  });

  const knownKeys = new Set(unitsFromStructure.map((item) => getUnitKey(item.wingName, item.unitNumber)));

  occupants.forEach((item) => {
    const key = getUnitKey(item.wingName, item.unitNumber);
    if (!knownKeys.has(key)) {
      knownKeys.add(key);
      unitsFromStructure.push({ wingName: item.wingName, unitNumber: item.unitNumber });
    }
  });

  const rows = [];

  unitsFromStructure.forEach((unit) => {
    const key = getUnitKey(unit.wingName, unit.unitNumber);
    const maintenance = maintenanceByUnitKey.get(key);
    if (!maintenance && !includePendingMissing) return;

    const items = unitGroups[key] || [];
    const occupancyKind = items.length > 0 ? classifyUnitGroup(items) : 'vacant';
    const occupancyStatus = mapOccupancyLabel(occupancyKind);

    if (!maintenance) {
      rows.push({
        wingNumber: unit.wingName || '-',
        unitNumber: unit.unitNumber || '-',
        occupancyStatus,
        month,
        year: String(year),
        maintenanceStatus: STATUS_LABELS.pending,
        isRejected: 'No',
        rejectedReason: '-',
      });
      return;
    }

    const maintenanceStatusKey = normalizeMaintenanceStatus(maintenance.status);
    const maintenanceStatus = STATUS_LABELS[maintenanceStatusKey] || 'Pending';
    const isRejected = maintenanceStatusKey === 'rejected' ? 'Yes' : 'No';

    const rejectedReasonRaw = [maintenance.rejectionReason, maintenance.rejectionDescription]
      .map((value) => normalizeString(value))
      .filter(Boolean)
      .join(' | ');

    rows.push({
      wingNumber: unit.wingName || '-',
      unitNumber: unit.unitNumber || '-',
      occupancyStatus,
      month,
      year: String(year),
      maintenanceStatus,
      isRejected,
      rejectedReason: rejectedReasonRaw || '-',
    });
  });

  rows.sort((a, b) => {
    const wingCmp = String(a.wingNumber).localeCompare(String(b.wingNumber), undefined, { sensitivity: 'base' });
    if (wingCmp !== 0) return wingCmp;
    return String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, { numeric: true, sensitivity: 'base' });
  });

  return rows;
};

const generateAndUploadMaintenanceReport = async ({ societyId, month, year, status }) => {
  const normalizedSocietyId = normalizeString(societyId);
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const normalizedMonth = normalizeMonth(month);
  const normalizedYear = normalizeYear(year);
  const normalizedStatus = normalizeStatusFilter(status);

  const lockKey = `maintenance:${normalizedSocietyId}:${normalizedMonth}:${normalizedYear}:${normalizedStatus}`;
  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const rows = await buildReportRows({
      societyId: normalizedSocietyId,
      month: normalizedMonth,
      year: normalizedYear,
      statusFilter: normalizedStatus,
    });

    const workbookBuffer = await buildWorkbookBuffer({
      rows,
      month: normalizedMonth,
      year: normalizedYear,
      statusFilter: normalizedStatus,
    });

    const objectKey = `reports/${normalizedSocietyId}/maintenance-report-${normalizedStatus}.xlsx`;

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
      status: normalizedStatus,
      month: normalizedMonth,
      year: normalizedYear,
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
  normalizeMonth,
  normalizeYear,
  normalizeStatusFilter,
  generateAndUploadMaintenanceReport,
};
