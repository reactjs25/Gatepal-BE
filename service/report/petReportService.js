const ExcelJS = require('exceljs');
const Pet = require('../../model/petSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const Society = require('../../model/societySchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');
const { toISTDateLabel } = require('../../utils/dateTime');

const inFlightJobs = new Map();

const toLower = (value) => String(value || '').trim().toLowerCase();

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

const formatDate = (value) => {
  if (!value) return '-';
  return toISTDateLabel(value) || '-';
};

const buildWorkbookBuffer = async ({ rows, societyName }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Pets');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Pet Name', key: 'petName' },
    { header: 'Pet Category', key: 'petCategory' },
    { header: 'Wing', key: 'wing' },
    { header: 'Unit Number', key: 'unitNumber' },
    { header: 'Vaccination Status', key: 'vaccinationStatus' },
    { header: 'Last Vaccination Date', key: 'lastVaccinationDate' },
    { header: 'Next Vaccination Date', key: 'nextVaccinationDate' },
  ];

  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));

  if (rows.length === 0) {
    worksheet.addRow({
      petName: 'No records found',
      petCategory: '-',
      wing: '-',
      unitNumber: '-',
      vaccinationStatus: '-',
      lastVaccinationDate: '-',
      nextVaccinationDate: '-',
    });
  }

  autosizeColumns(worksheet);

  workbook.properties.subject = `Pet List Report (${societyName || 'Society'})`;
  workbook.properties.title = `${societyName || 'Society'} Pet List`;

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

  const pets = await Pet.find(
    {
      unitId: { $regex: `^${String(societyId)}:` },
      deletedAt: null,
    },
    {
      name: 1,
      petType: 1,
      vaccinationStatus: 1,
      lastVaccinationDate: 1,
      nextVaccinationDueDate: 1,
      unitId: 1,
    }
  ).lean();

  const rows = pets
    .map((pet) => {
      const unitInfo = unitMap[pet.unitId] || {};
      return {
        petName: pet.name || '-',
        petCategory: pet.petType || '-',
        wing: unitInfo.wingName || '-',
        unitNumber: unitInfo.unitNumber || '-',
        vaccinationStatus: pet.vaccinationStatus || '-',
        lastVaccinationDate: formatDate(pet.lastVaccinationDate),
        nextVaccinationDate: formatDate(pet.nextVaccinationDueDate),
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

      return String(a.petName).localeCompare(String(b.petName), undefined, {
        sensitivity: 'base',
      });
    });

  return {
    societyName: society.societyName,
    rows,
  };
};

const generateAndUploadPetReport = async ({ societyId }) => {
  const normalizedSocietyId = String(societyId || '').trim();
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const lockKey = `pet-list:${normalizedSocietyId}`;
  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const { societyName, rows } = await buildRows({ societyId: normalizedSocietyId });

    const workbookBuffer = await buildWorkbookBuffer({ rows, societyName });
    const objectKey = `reports/${normalizedSocietyId}/pet-list.xlsx`;

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
  generateAndUploadPetReport,
};
