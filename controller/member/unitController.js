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
const mongoose = require('mongoose');

const UI_OCCUPANCY_ALLOWED = new Set([
  'owner_is_residing',
  'unit_is_empty',
  'unit_is_rented_out',
]);

const mapUiToCanonicalOccupancy = (value) => {
  const v = normalizeString(value).toLowerCase();
  if (v === 'owner_is_residing') return 'currently_residing';
  if (v === 'unit_is_empty') return 'unit_vacant';
  if (v === 'unit_is_rented_out') return 'unit_rented';
  return '';
};

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

    const primaryOccupant = await MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType: { $in: ['unit_owner', 'tenant'] },
    }).lean();

    if (occupantType === 'unit_owner' || occupantType === 'tenant') {
      if (primaryOccupant) {
        return next(
          createHttpError(
            'A primary occupant already exists for this unit. Choose unit_owner_family_member or tenant_family_member.',
            409
          )
        );
      }
    } else if (occupantType === 'unit_owner_family_member') {
      if (!primaryOccupant || primaryOccupant.occupantType !== 'unit_owner') {
        return next(
          createHttpError(
            'Unit owner must be registered for this unit before adding owner family members.',
            400
          )
        );
      }
    } else if (occupantType === 'tenant_family_member') {
      if (!primaryOccupant || primaryOccupant.occupantType !== 'tenant') {
        return next(
          createHttpError(
            'Tenant must be registered for this unit before adding tenant family members.',
            400
          )
        );
      }
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

    const payload = {
      memberId: targetUser._id,
      societyId: society._id,
      wingName,
      wingNameLower: wingName.toLowerCase(),
      unitNumber,
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType,
      occupancyStatus,
      ...(occupantType === 'unit_owner_family_member' && primaryOccupant
        ? { primaryMemberId: primaryOccupant.memberId }
        : {}),
      ...(occupantType === 'tenant_family_member' && primaryOccupant
        ? { primaryMemberId: primaryOccupant.memberId }
        : {}),
    };

    const doc = await MemberUnit.create(payload);

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

const updateUnitOccupancyStatus = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can update unit occupancy status', 403));
    }

    const unitId = normalizeString(req.params.id || req.params.unit_id || '');
    const incomingStatus = normalizeString(req.body.occupancy_status);

    if (!unitId) {
      return next(createHttpError('unit_id is required', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit_id', 400));
    }

    if (!incomingStatus) {
      return next(createHttpError('occupancy_status is required', 400));
    }

    if (!UI_OCCUPANCY_ALLOWED.has(incomingStatus)) {
      return next(
        createHttpError(
          'occupancy_status must be one of owner_is_residing, unit_is_empty, unit_is_rented_out',
          400
        )
      );
    }

    const canonical = mapUiToCanonicalOccupancy(incomingStatus);

    if (!canonical || !OCCUPANCY_STATUSES.has(canonical)) {
      return next(createHttpError('Invalid occupancy status value', 400));
    }

    const doc = await MemberUnit.findById(unitId);

    if (!doc) {
      return next(createHttpError('Unit not found', 404));
    }

    if (String(doc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit', 403));
    }

    doc.occupancyStatus = canonical;
    await doc.save();

    const society = await Society.findById(doc.societyId).lean();

    return sendSuccessResponse(res, 200, 'Unit occupancy status updated successfully', {
      data: {
        id: String(doc._id),
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        societyName: society ? society.societyName : undefined,
        societyPin: society ? society.societyPin : undefined,
        city: society ? society.city : undefined,
        country: society ? society.country : undefined,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update unit occupancy status'));
  }
};

const getUnitById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    const unitId = normalizeString(req.params.id || '');

    if (!unitId) {
      return next(createHttpError('unitId path parameter is required', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit ID format', 400));
    }

    const doc = await MemberUnit.findById(unitId);

    if (!doc) {
      return next(createHttpError('Unit not found', 404));
    }

    if (String(doc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit', 403));
    }

    const society = await Society.findById(doc.societyId).lean();
    const member = await User.findById(doc.memberId).lean();

    return sendSuccessResponse(res, 200, 'Unit details fetched successfully', {
      data: {
        id: String(doc._id),
        memberName: member ? member.fullName || null : null,
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        society: society
          ? {
            id: String(society._id),
            name: society.societyName,
            pin: society.societyPin,
            address: society.address,
            city: society.city,
            country: society.country,
          }
          : null,

        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch unit details'));
  }
};

module.exports = {
  addMemberUnit,
  validateMemberUnitPayload,
  updateUnitOccupancyStatus,
  getUnitById,
};
