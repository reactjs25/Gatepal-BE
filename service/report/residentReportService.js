const ExcelJS = require('exceljs');
const FamilyMember = require('../../model/familyMemberSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');

const inFlightJobs = new Map();

const mapResidentType = (occupantType) => {
  if (occupantType === 'unit_owner') return 'Owner';
  if (occupantType === 'unit_owner_family_member') return 'Owner Family Member';
  if (occupantType === 'tenant') return 'Tenant';
  if (occupantType === 'tenant_family_member') return 'Tenant Family Member';
  return '-';
};

const mapAgeGroup = (category) => {
  if (category === 'adult') return 'Adult';
  if (category === 'child') return 'Child';
  return '-';
};

const toDisplayPhone = ({ countryCode, phoneNumber }) => {
  const cc = String(countryCode || '').trim();
  const phone = String(phoneNumber || '').trim();
  if (!cc && !phone) return '-';
  if (!cc) return phone || '-';
  return `${cc} ${phone}`.trim();
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

const buildWorkbookBuffer = async ({ rows }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Residents');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Name', key: 'name' },
    { header: 'Mobile Number', key: 'mobileNumber' },
    { header: 'Wing', key: 'wing' },
    { header: 'Unit Number', key: 'unitNumber' },
    { header: 'Resident Type', key: 'residentType' },
    { header: 'Age Group', key: 'ageGroup' },
  ];

  worksheet.getRow(1).font = { bold: true };

  rows.forEach((row) => worksheet.addRow(row));

  if (rows.length === 0) {
    worksheet.addRow({
      name: 'No records found',
      mobileNumber: '-',
      wing: '-',
      unitNumber: '-',
      residentType: '-',
      ageGroup: '-',
    });
  }

  autosizeColumns(worksheet);

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const fetchResidentRows = async ({ societyId }) => {
  const occupants = await MemberUnit.find(
    { societyId },
    {
      _id: 1,
      memberId: 1,
      wingName: 1,
      unitNumber: 1,
      occupantType: 1,
      createdAt: 1,
    }
  ).lean();

  const unitIds = occupants.map((unit) => unit._id);
  const familyMembers = unitIds.length
    ? await FamilyMember.find(
        { unitId: { $in: unitIds } },
        {
          _id: 1,
          unitId: 1,
          name: 1,
          category: 1,
          countryCode: 1,
          phoneNumber: 1,
          linkedUserId: 1,
          createdAt: 1,
        }
      ).lean()
    : [];

  const linkedUserIdSet = new Set(
    familyMembers
      .map((member) => (member?.linkedUserId ? String(member.linkedUserId) : ''))
      .filter(Boolean)
  );

  const occupantMemberIds = Array.from(
    new Set(occupants.map((unit) => (unit?.memberId ? String(unit.memberId) : '')).filter(Boolean))
  );

  const users = occupantMemberIds.length
    ? await User.find(
        { _id: { $in: occupantMemberIds } },
        { _id: 1, fullName: 1, countryCode: 1, phoneNumber: 1 }
      ).lean()
    : [];

  const userById = new Map(users.map((user) => [String(user._id), user]));
  const occupantByUnitId = new Map(occupants.map((unit) => [String(unit._id), unit]));

  const rows = [];

  familyMembers.forEach((member) => {
    const unit = occupantByUnitId.get(String(member.unitId));
    rows.push({
      name: member.name || '-',
      mobileNumber: toDisplayPhone({
        countryCode: member.countryCode,
        phoneNumber: member.phoneNumber,
      }),
      wing: unit?.wingName || '-',
      unitNumber: unit?.unitNumber || '-',
      residentType: mapResidentType(unit?.occupantType),
      ageGroup: mapAgeGroup(member.category),
      _sortWing: String(unit?.wingName || ''),
      _sortUnit: String(unit?.unitNumber || ''),
      _sortName: String(member.name || ''),
    });
  });

  occupants.forEach((unit) => {
    const memberId = unit?.memberId ? String(unit.memberId) : '';
    if (!memberId || linkedUserIdSet.has(memberId)) {
      return;
    }

    const user = userById.get(memberId);
    if (!user) {
      return;
    }

    rows.push({
      name: user.fullName || '-',
      mobileNumber: toDisplayPhone({
        countryCode: user.countryCode,
        phoneNumber: user.phoneNumber,
      }),
      wing: unit.wingName || '-',
      unitNumber: unit.unitNumber || '-',
      residentType: mapResidentType(unit.occupantType),
      ageGroup: 'Adult',
      _sortWing: String(unit.wingName || ''),
      _sortUnit: String(unit.unitNumber || ''),
      _sortName: String(user.fullName || ''),
    });
  });

  rows.sort((a, b) => {
    const wingCmp = a._sortWing.localeCompare(b._sortWing, undefined, { sensitivity: 'base' });
    if (wingCmp !== 0) return wingCmp;

    const unitCmp = a._sortUnit.localeCompare(b._sortUnit, undefined, { numeric: true, sensitivity: 'base' });
    if (unitCmp !== 0) return unitCmp;

    return a._sortName.localeCompare(b._sortName, undefined, { sensitivity: 'base' });
  });

  return rows.map(({ _sortWing, _sortUnit, _sortName, ...rest }) => rest);
};

const generateAndUploadResidentReport = async ({ societyId }) => {
  const normalizedSocietyId = String(societyId || '').trim();
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const lockKey = `resident-list:${normalizedSocietyId}`;
  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const rows = await fetchResidentRows({ societyId: normalizedSocietyId });
    const workbookBuffer = await buildWorkbookBuffer({ rows });

    const objectKey = `reports/${normalizedSocietyId}/resident-list.xlsx`;

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
  generateAndUploadResidentReport,
};
