const ExcelJS = require('exceljs');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const Vehicle = require('../../model/vehicleSchema');
const Pet = require('../../model/petSchema');
const { uploadBufferToS3ByKey } = require('../../utils/s3Upload');
const { createHttpError } = require('../../utils/httpError');
const { toISTDateLabel } = require('../../utils/dateTime');

const inFlightJobs = new Map();

const toLower = (value) => String(value || '').trim().toLowerCase();

const UNIT_OCCUPANCY_LABELS = Object.freeze({
  owner: 'Owner Residing',
  tenant: 'Tenant Residing',
  vacant: 'Vacant',
});

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

const getCanonicalUnitKey = ({ wingName, unitNumber }) => `${toLower(wingName)}:${toLower(unitNumber)}`;

const getCanonicalUnitId = ({ societyId, wingName, unitNumber }) =>
  `${String(societyId)}:${toLower(wingName)}:${toLower(unitNumber)}`;

const mapPersonSlots = (people = [], maxSlots = 3) => {
  const slots = [];
  for (let index = 0; index < maxSlots; index += 1) {
    const item = people[index] || null;
    slots.push({
      name: item?.name || '-',
      phone: item?.phone || '-',
    });
  }
  return slots;
};

const toDisplayPhone = (user) => {
  const countryCode = String(user?.countryCode || '').trim();
  const phone = String(user?.phoneNumber || '').trim();
  if (!countryCode && !phone) return '-';
  if (!countryCode) return phone || '-';
  return `${countryCode} ${phone}`.trim();
};

const sortOccupants = (a, b) => {
  const typePriority = (type) => (type === 'unit_owner' || type === 'tenant' ? 0 : 1);
  const priorityDiff = typePriority(a.occupantType) - typePriority(b.occupantType);
  if (priorityDiff !== 0) return priorityDiff;

  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return aTime - bTime;
};

const autosizeColumns = (worksheet) => {
  worksheet.columns.forEach((column) => {
    const lengths = [
      String(column.header || '').length,
      ...column.values.slice(1).map((value) => String(value == null ? '' : value).length),
    ];
    const maxLength = Math.max(...lengths, 10);
    column.width = Math.min(maxLength + 2, 38);
  });
};

const generateWorkbookBuffer = async ({ rows, societyName }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gatepal Server';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Units List');
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = [
    { header: 'Wing', key: 'wing' },
    { header: 'Unit Number', key: 'unitNumber' },
    { header: 'Occupancy Status', key: 'occupancyStatus' },
    { header: 'GatePal Registration Status', key: 'registrationStatus' },
    { header: 'Resident Type', key: 'residentType' },
    { header: 'GatePal Registration Date', key: 'registrationDate' },
    { header: 'Owner 1 Name', key: 'owner1Name' },
    { header: 'Owner 1 Phone Number', key: 'owner1Phone' },
    { header: 'Owner 2 Name', key: 'owner2Name' },
    { header: 'Owner 2 Phone Number', key: 'owner2Phone' },
    { header: 'Owner 3 Name', key: 'owner3Name' },
    { header: 'Owner 3 Phone Number', key: 'owner3Phone' },
    { header: 'Tenant 1 Name', key: 'tenant1Name' },
    { header: 'Tenant 1 Phone Number', key: 'tenant1Phone' },
    { header: 'Tenant 2 Name', key: 'tenant2Name' },
    { header: 'Tenant 2 Phone Number', key: 'tenant2Phone' },
    { header: 'Tenant 3 Name', key: 'tenant3Name' },
    { header: 'Tenant 3 Phone Number', key: 'tenant3Phone' },
    { header: 'Number of Owner Family Members', key: 'ownerFamilyMembers' },
    { header: 'Number of Tenant Family Members', key: 'tenantFamilyMembers' },
    { header: 'Number of Two Wheelers', key: 'twoWheelers' },
    { header: 'Number of Four Wheelers', key: 'fourWheelers' },
    { header: 'Number of Other Vehicles', key: 'otherVehicles' },
    { header: 'Number of Pets', key: 'petsCount' },
  ];

  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));

  if (rows.length === 0) {
    worksheet.addRow({
      wing: 'No records found',
      unitNumber: '-',
      occupancyStatus: '-',
      registrationStatus: '-',
      residentType: '-',
      registrationDate: '-',
      owner1Name: '-',
      owner1Phone: '-',
      owner2Name: '-',
      owner2Phone: '-',
      owner3Name: '-',
      owner3Phone: '-',
      tenant1Name: '-',
      tenant1Phone: '-',
      tenant2Name: '-',
      tenant2Phone: '-',
      tenant3Name: '-',
      tenant3Phone: '-',
      ownerFamilyMembers: 0,
      tenantFamilyMembers: 0,
      twoWheelers: 0,
      fourWheelers: 0,
      otherVehicles: 0,
      petsCount: 0,
    });
  }

  autosizeColumns(worksheet);

  workbook.properties.subject = `Units List Report (${societyName || 'Society'})`;
  workbook.properties.title = `${societyName || 'Society'} Units List`;

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

const buildVehicleCountsByUnit = async (canonicalUnitIds) => {
  if (!canonicalUnitIds.length) return new Map();

  const records = await Vehicle.aggregate([
    { $match: { unitId: { $in: canonicalUnitIds }, deletedAt: null } },
    {
      $group: {
        _id: { unitId: '$unitId', vehicleType: '$vehicleType' },
        count: { $sum: 1 },
      },
    },
  ]);

  const map = new Map();
  records.forEach((record) => {
    const unitId = String(record?._id?.unitId || '');
    const type = String(record?._id?.vehicleType || '');
    if (!unitId) return;

    const existing = map.get(unitId) || { two: 0, four: 0, other: 0 };

    if (type === 'Two-Wheeler') existing.two += Number(record.count || 0);
    else if (type === 'Four-Wheeler') existing.four += Number(record.count || 0);
    else existing.other += Number(record.count || 0);

    map.set(unitId, existing);
  });

  return map;
};

const buildPetCountsByUnit = async (canonicalUnitIds) => {
  if (!canonicalUnitIds.length) return new Map();

  const records = await Pet.aggregate([
    { $match: { unitId: { $in: canonicalUnitIds }, deletedAt: null } },
    { $group: { _id: '$unitId', count: { $sum: 1 } } },
  ]);

  const map = new Map();
  records.forEach((record) => {
    const unitId = String(record?._id || '');
    if (!unitId) return;
    map.set(unitId, Number(record.count || 0));
  });

  return map;
};

const fetchUnitRows = async ({ societyId }) => {
  const society = await Society.findById(societyId).lean();
  if (!society) {
    throw createHttpError('Society not found.', 404);
  }

  const wings = Array.isArray(society.structure) ? society.structure : [];

  const occupants = await MemberUnit.find(
    { societyId },
    {
      memberId: 1,
      wingName: 1,
      wingNameLower: 1,
      unitNumber: 1,
      unitNumberLower: 1,
      occupantType: 1,
      occupancyStatus: 1,
      createdAt: 1,
    }
  ).lean();

  const unitsByKey = new Map();
  occupants.forEach((item) => {
    const key = `${item.wingNameLower}:${item.unitNumberLower}`;
    const existing = unitsByKey.get(key) || [];
    existing.push(item);
    unitsByKey.set(key, existing);
  });

  const allUnitKeys = new Map();

  wings.forEach((wing) => {
    const wingName = wing?.wingName || '';
    const units = Array.isArray(wing?.units) ? wing.units : [];
    units.forEach((unit) => {
      const unitNumber = unit?.unitNumber || '';
      const key = getCanonicalUnitKey({ wingName, unitNumber });
      allUnitKeys.set(key, { wingName, unitNumber });
    });
  });

  occupants.forEach((item) => {
    const key = getCanonicalUnitKey({ wingName: item.wingName, unitNumber: item.unitNumber });
    if (!allUnitKeys.has(key)) {
      allUnitKeys.set(key, { wingName: item.wingName, unitNumber: item.unitNumber });
    }
  });

  const allUnits = Array.from(allUnitKeys.values()).sort((a, b) => {
    const wingCmp = String(a.wingName || '').localeCompare(String(b.wingName || ''), undefined, { sensitivity: 'base' });
    if (wingCmp !== 0) return wingCmp;
    return String(a.unitNumber || '').localeCompare(String(b.unitNumber || ''), undefined, { numeric: true, sensitivity: 'base' });
  });

  const memberIds = Array.from(new Set(occupants.map((item) => String(item.memberId)).filter(Boolean)));
  const users = memberIds.length
    ? await User.find({ _id: { $in: memberIds } }, { _id: 1, fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
    : [];

  const userById = new Map(users.map((user) => [String(user._id), user]));

  const canonicalUnitIds = allUnits.map((unit) => getCanonicalUnitId({
    societyId,
    wingName: unit.wingName,
    unitNumber: unit.unitNumber,
  }));

  const [vehicleCountsByUnitId, petCountsByUnitId] = await Promise.all([
    buildVehicleCountsByUnit(canonicalUnitIds),
    buildPetCountsByUnit(canonicalUnitIds),
  ]);

  const rows = allUnits.map((unit) => {
    const key = getCanonicalUnitKey(unit);
    const items = [...(unitsByKey.get(key) || [])].sort(sortOccupants);
    const canonicalUnitId = getCanonicalUnitId({ societyId, wingName: unit.wingName, unitNumber: unit.unitNumber });

    const isRegistered = items.length > 0;
    const kind = isRegistered ? classifyUnitGroup(items) : null;
    const occupancyStatus = kind ? UNIT_OCCUPANCY_LABELS[kind] : 'Vacant';
    const registrationStatus = isRegistered ? 'Registered on GatePal' : 'Not Registered on GatePal';
    const residentType = kind === 'tenant' ? 'Tenant' : kind === 'owner' ? 'Owner' : '-';

    const registrationDate = isRegistered
      ? toISTDateLabel(
          items.reduce((earliest, current) => {
            if (!earliest) return current.createdAt;
            return new Date(current.createdAt) < new Date(earliest) ? current.createdAt : earliest;
          }, null)
        ) || '-'
      : '-';

    const ownerOccupants = items
      .filter((item) => item.occupantType === 'unit_owner' || item.occupantType === 'unit_owner_family_member')
      .map((item) => {
        const user = userById.get(String(item.memberId));
        return {
          name: user?.fullName || '-',
          phone: toDisplayPhone(user),
        };
      });

    const tenantOccupants = items
      .filter((item) => item.occupantType === 'tenant' || item.occupantType === 'tenant_family_member')
      .map((item) => {
        const user = userById.get(String(item.memberId));
        return {
          name: user?.fullName || '-',
          phone: toDisplayPhone(user),
        };
      });

    const ownerSlots = mapPersonSlots(ownerOccupants, 3);
    const tenantSlots = mapPersonSlots(tenantOccupants, 3);

    const ownerFamilyMembers = items.filter((item) => item.occupantType === 'unit_owner_family_member').length;
    const tenantFamilyMembers = items.filter((item) => item.occupantType === 'tenant_family_member').length;

    const vehicleCounts = vehicleCountsByUnitId.get(canonicalUnitId) || { two: 0, four: 0, other: 0 };
    const petsCount = petCountsByUnitId.get(canonicalUnitId) || 0;

    return {
      wing: unit.wingName || '-',
      unitNumber: unit.unitNumber || '-',
      occupancyStatus,
      registrationStatus,
      residentType,
      registrationDate,
      owner1Name: ownerSlots[0].name,
      owner1Phone: ownerSlots[0].phone,
      owner2Name: ownerSlots[1].name,
      owner2Phone: ownerSlots[1].phone,
      owner3Name: ownerSlots[2].name,
      owner3Phone: ownerSlots[2].phone,
      tenant1Name: tenantSlots[0].name,
      tenant1Phone: tenantSlots[0].phone,
      tenant2Name: tenantSlots[1].name,
      tenant2Phone: tenantSlots[1].phone,
      tenant3Name: tenantSlots[2].name,
      tenant3Phone: tenantSlots[2].phone,
      ownerFamilyMembers,
      tenantFamilyMembers,
      twoWheelers: vehicleCounts.two,
      fourWheelers: vehicleCounts.four,
      otherVehicles: vehicleCounts.other,
      petsCount,
    };
  });

  return {
    societyName: society.societyName,
    rows,
  };
};

const generateAndUploadUnitListReport = async ({ societyId }) => {
  const normalizedSocietyId = String(societyId || '').trim();
  if (!normalizedSocietyId) {
    throw createHttpError('societyId is required for report generation.', 400);
  }

  const lockKey = `unit-list:${normalizedSocietyId}`;
  if (inFlightJobs.has(lockKey)) {
    return inFlightJobs.get(lockKey);
  }

  const task = (async () => {
    const { societyName, rows } = await fetchUnitRows({ societyId: normalizedSocietyId });

    const workbookBuffer = await generateWorkbookBuffer({
      rows,
      societyName,
    });

    const objectKey = `reports/${normalizedSocietyId}/unit-list.xlsx`;

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
  generateAndUploadUnitListReport,
};
