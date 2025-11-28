const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');

const OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);
const OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);

const normalizeString = (value) => (value || '').toString().trim();

const toCanonicalEnum = (value, allowed) => {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const title = normalized
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
    .replace(/^o(wner)?$/, 'owner')
    .replace(/^unitowner$/, 'unitowner')
    .replace(/^(ownerfamily|ownerfamilymember|unitownerfamilymember)$/, 'ownerfamilymember')
    .replace(/^t(enant)?$/, 'tenant')
    .replace(/^(tenantfamily|tenantfamilymember)$/, 'tenantfamilymember')
    .replace(/^(currentlyresiding)$/, 'currentlyresiding')
    .replace(/^(unitrented|rented)$/, 'unitrented')
    .replace(/^(unitvacant|vacant)$/, 'unitvacant')
    .replace(/^occupied$/, 'currentlyresiding');

  const mapping = {
    owner: 'unit_owner',
    unitowner: 'unit_owner',
    ownerfamilymember: 'unit_owner_family_member',
    tenant: 'tenant',
    tenantfamilymember: 'tenant_family_member',
    currentlyresiding: 'currently_residing',
    unitrented: 'unit_rented',
    unitvacant: 'unit_vacant',
  };

  const canonical = mapping[title] || value;
  return allowed.has(canonical) ? canonical : '';
};

const validateMemberUnitPayload = (payload = {}) => {
  const city = normalizeString(payload.city);
  const societyName = normalizeString(payload.societyName);
  const societyPin = normalizeString(payload.societyPin);

  const wingName = normalizeString(payload.wingName ?? payload.wing);
  const unitNumber = normalizeString(payload.unitNumber ?? payload.unnitNumber ?? payload.unit);

  const rawOccupantType = payload.occupantType ?? payload.occupancyType;
  const occupantType = toCanonicalEnum(rawOccupantType, OCCUPANT_TYPES);
  const occupancyStatus = toCanonicalEnum(payload.occupancyStatus, OCCUPANCY_STATUSES);

  if (!societyPin) {
    throw createHttpError('societyPin is required', 400);
  }

  if (!wingName || !unitNumber) {
    throw createHttpError('wingName and unitNumber are required', 400);
  }

  if (!occupantType) {
    throw createHttpError(
      'occupantType must be one of unit_owner, unit_owner_family_member, tenant, tenant_family_member',
      400
    );
  }

  if (!occupancyStatus) {
    throw createHttpError(
      'occupancyStatus must be one of currently_residing, unit_rented, unit_vacant',
      400
    );
  }

  return { city, societyName, societyPin, wingName, unitNumber, occupantType, occupancyStatus };
};

const findWingAndUnit = (society, wingName, unitNumber) => {
  const wings = Array.isArray(society.structure) ? society.structure : [];
  const wing = wings.find((w) => w?.wingName && w.wingName.trim().toLowerCase() === wingName.toLowerCase());
  if (!wing) return { wing: null, unit: null };
  const units = Array.isArray(wing.units) ? wing.units : [];
  const unit = units.find((u) => u?.unitNumber && u.unitNumber.trim().toLowerCase() === unitNumber.toLowerCase());
  return { wing, unit };
};

const addMemberUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    const { city, societyName, societyPin, wingName, unitNumber, occupantType, occupancyStatus } =
      validateMemberUnitPayload(req.body || {});

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can add units to their account', 403));
    }

    const targetUser = authUser;

    let society = await Society.findOne({ societyPin: societyPin }).lean();
    if (!society) {
      const nameFilter = societyName ? { societyName: societyName } : {};
      const cityFilter = city ? { city: city } : {};
      society = await Society.findOne({ ...nameFilter, ...cityFilter }).lean();
    }
    if (!society) {
      return next(createHttpError('Society not found for provided details', 404));
    }
    if (societyPin && normalizeString(society.societyPin) !== societyPin) {
      return next(createHttpError('Provided societyPin does not match selected society', 400));
    }

    const { wing, unit } = findWingAndUnit(society, wingName, unitNumber);
    if (!wing) {
      return next(createHttpError('Wing not found in the member’s society', 404));
    }
    if (!unit) {
      return next(createHttpError('Unit not found in the specified wing', 404));
    }

    const exists = await MemberUnit.exists({
      memberId: targetUser._id,
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
    });

    if (exists) {
      return next(createHttpError('This unit has already been added for the member', 409));
    }

    const doc = await MemberUnit.create({
      memberId: targetUser._id,
      societyId: society._id,
      wingName,
      wingNameLower: wingName.toLowerCase(),
      unitNumber,
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType,
      occupancyStatus,
    });

    return sendSuccessResponse(res, 201, 'Unit added successfully', {
      data: {
        id: doc._id,
        societyName: society.societyName,
        societyPin: society.societyPin,
        city: society.city,
        country: society.country,
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        memberName: targetUser.fullName || null,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add unit for member'));
  }
};

module.exports = {
  addMemberUnit,
  validateMemberUnitPayload,
};
