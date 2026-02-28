const ExcelJS = require('exceljs');
const Vehicle = require('../../model/vehicleSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const Society = require('../../model/societySchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');

const inFlightJobs = new Map();

const toLower = (value) => String(value || '').trim().toLowerCase();

const mapVehicleTypeLabel = (value) => {
  const normalized = toLower(value);
  if (normalized === 'two-wheeler') return 'Two wheeler';
  if (normalized === 'four-wheeler') return 'Four wheeler';
  return 'Other';
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

const buildWorkbookBuffer = async ({ rows, societyName }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Vehicles');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Vehicle Number', key: 'vehicleNumber' },
    { header: 'Vehicle Type', key: 'vehicleType' },
    { header: 'Wing', key: 'wing' },
    { header: 'Unit Number', key: 'unitNumber' },
  ];

  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));

  if (rows.length === 0) {
    worksheet.addRow({
      vehicleNumber: 'No records found',
      vehicleType: '-',
      wing: '-',
      unitNumber: '-',
    });
  }

  autosizeColumns(worksheet);

  workbook.properties.subject = `Vehicle List Report (${societyName || 'Society'})`;
  workbook.properties.title = `${societyName || 'Society'} Vehicle List`;

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const buildRows = async ({ societyId }) => {
  const society = await Society.findById(societyId).lean();
  if (!society) {
    throw createHttpError('Society not found.', 404);
  }

  const occupants = await MemberUnit.find(
    { societyId },
    { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1 }
  ).lean();

  const unitMap = occupants.reduce((acc, unit) => {
    const canonical = `${String(societyId)}:${unit.wingNameLower}:${unit.unitNumberLower}`;
    if (!acc[canonical]) {
      acc[canonical] = {
        wingName: unit.wingName,
        unitNumber: unit.unitNumber,
      };
    }
    return acc;
  }, {});

  const vehicles = await Vehicle.find(
    {
      unitId: { $regex: `^${String(societyId)}:` },
      deletedAt: null,
    },
    {
      vehicleNumber: 1,
      vehicleType: 1,
      unitId: 1,
      createdAt: 1,
    }
  ).lean();

  const rows = vehicles
    .map((vehicle) => {
      const unitInfo = unitMap[vehicle.unitId] || {};
      return {
        vehicleNumber: vehicle.vehicleNumber || '-',
        vehicleType: mapVehicleTypeLabel(vehicle.vehicleType),
        wing: unitInfo.wingName || '-',
        unitNumber: unitInfo.unitNumber || '-',
      };
    })
    .sort((a, b) => {
      const wingCmp = String(a.wing).localeCompare(String(b.wing), undefined, { sensitivity: 'base' });
      if (wingCmp !== 0) return wingCmp;

      const unitCmp = String(a.unitNumber).localeCompare(String(b.unitNumber), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (unitCmp !== 0) return unitCmp;

      return String(a.vehicleNumber).localeCompare(String(b.vehicleNumber), undefined, {
        sensitivity: 'base',
      });
    });

  return {
    societyName: society.societyName,
    rows,
  };
};

const generateAndUploadVehicleReport = async ({ societyId }) => {
  const normalizedSocietyId = String(societyId || '').trim();
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const lockKey = `vehicle-list:${normalizedSocietyId}`;
  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const { societyName, rows } = await buildRows({ societyId: normalizedSocietyId });

    const workbookBuffer = await buildWorkbookBuffer({ rows, societyName });
    const objectKey = `reports/${normalizedSocietyId}/vehicle-list.xlsx`;

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
  generateAndUploadVehicleReport,
};
