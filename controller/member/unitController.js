const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const FamilyMember = require('../../model/familyMemberSchema');
const Vehicle = require('../../model/vehicleSchema');
const Pet = require('../../model/petSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { toCanonicalOccupantType, toCanonicalOccupancyStatus, mapUiToCanonicalOccupancy } = require('../../utils/enums/memberEnums');
const { assertUnitAccess, buildCanonicalUnitId } = require('../../utils/unitAccess');

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


const validateMemberUnitPayload = (payload = {}) => {
  const city = normalizeString(payload.city);
  const societyName = normalizeString(payload.societyName);
  const societyPin = normalizeString(payload.societyPin);

  const wingName = normalizeString(payload.wingName ?? payload.wing);
  const unitNumber = normalizeString(payload.unitNumber ?? payload.unnitNumber ?? payload.unit);

  const rawOccupantType = payload.occupantType ?? payload.occupancyType;
  const occupantType = toCanonicalOccupantType(rawOccupantType);
  const occupancyStatus = toCanonicalOccupancyStatus(payload.occupancyStatus);

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

    const primaryOwner = await MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType: 'unit_owner',
    })
      .sort({ createdAt: 1 })
      .lean();

    const primaryTenant = await MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType: 'tenant',
    }).lean();

    if (occupantType === 'tenant') {
      if (primaryTenant) {
        return next(createHttpError('A tenant is already registered for this unit.', 409));
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
      ...(occupantType === 'unit_owner_family_member' && primaryOwner
        ? { primaryMemberId: primaryOwner.memberId }
        : {}),
      ...(occupantType === 'tenant_family_member' && primaryTenant
        ? { primaryMemberId: primaryTenant.memberId }
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

    return sendSuccessResponse(res, 200, 'Occupancy status updated successfully.', {
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

const getUnitDashboard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    const unitIdCandidate = normalizeString((req.body || {}).unitId);
    if (!unitIdCandidate) {
      return next(createHttpError('unitId is required', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const [familyCount, vehicleCount, petCount] = await Promise.all([
      FamilyMember.countDocuments({ unitId: unitDoc._id }),
      Vehicle.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
      Pet.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
    ]);

    const addedItems = [familyCount > 0, vehicleCount > 0, petCount > 0].filter(Boolean).length;
    const progressPercent = Math.round((addedItems / 3) * 100);

    const society_meeting = {
      id: 'meeting',
      title: 'Upcoming society meeting',
      description:
        'General meeting of society will be held on 13 Sep 2025, Thursday at 10:00 PM in the society hall. All members are requested to attend.',
      severity: 'success',
      ctaLabel: 'View Details',
      titleIcon: '/assets/society_icon.png',
      ctaLabelIcon: '/assets/view_details.png',
    };

    const Maintenance_proof = {
      id: 'maintenance_due',
      title: 'Upload Maintenance Proof',
      description:
        '5 days left to pay maintenance for Aug 2025, Upload maintenance proof on or before 10 Sep 2025.',
      severity: 'warning',
      ctaLabel: 'Upload Now',
      titleIcon: '/assets/maintainance.png',
      ctaLabelIcon: '/assets/upload.png',
    };

    const access_expire = {
      id: 'access_expire',
      title: 'App access is expiring in 3 months.',
      description:
        'Your GatePal app access is about to expire in 3 months, please renew your contract to continue using the app.',
      severity: 'warning',
      ctaLabel: 'Please contact your our support team.',
      titleIcon: '/assets/access_expire.png',
      ctaLabelIcon: '/assets/contact_support.png',
    };

    const recent_announcement = {
      id: 'recent_announcement',
      title: 'Recent Announcement',
      description:
        'Water supply in E-Block will not be available tomorrow, 25 Aug 2025 from 10 AM to 1 PM.',
      severity: 'success',
      ctaLabel: 'View Details',
      titleIcon: '/assets/announcement 1.png',
      ctaLabelIcon: '/assets/view_details.png',
    };

    const stableCountSeed = `${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`.length;
    const announcementCount = (stableCountSeed % 5) + 1;
    const meetingCount = ((stableCountSeed * 3) % 12) + 1;
    const society_rules = ((stableCountSeed * 5) % 7) + 1;

    const completeProfile = {
      progressPercent,
      items: {
        familyMember: {
          label: 'Family Member',
          added: familyCount > 0,
          count: familyCount,
          statusLabel: familyCount > 0 ? 'Added' : 'Add Now',
        },
        vehicles: {
          label: 'Vehicles',
          added: vehicleCount > 0,
          count: vehicleCount,
          statusLabel: vehicleCount > 0 ? 'Added' : 'Add Now',
        },
        pets: {
          label: 'Pets',
          added: petCount > 0,
          count: petCount,
          statusLabel: petCount > 0 ? 'Added' : 'Add Now',
        },
      },
    };

    const unit = {
      id: String(unitDoc._id),
      wingName: unitDoc.wingName,
      unitNumber: unitDoc.unitNumber,
    };

    const society = {
      announcementCount,
      meetingCount,
      society_rules,
    };

    const cards = [
      {
        unit,
      },
      {
        society,
      },
      {
        actionCardType: 'completeProfile',
        completeProfile,
      },
      {
        recent_announcement: 'announcement',
        announcement: [
          {
            actionCardType: 'upcomingMeeting',
            society_meeting: [society_meeting],
          },
          {
            actionCardType: 'uploadMaintenanceProof',
            Maintenance_proof: [Maintenance_proof],
          },
          {
            actionCardType: 'accessExpiring',
            access_expire: [access_expire],
          },
          {
            actionCardType: 'announcement',
            recent_announcement: [recent_announcement],
          },
        ],
      },
    ];

    return sendSuccessResponse(res, 200, 'Unit dashboard fetched successfully', {

      data: cards,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch unit dashboard'));
  }
};

module.exports = {
  addMemberUnit,
  validateMemberUnitPayload,
  updateUnitOccupancyStatus,
  getUnitById,
  getUnitDashboard,
};
