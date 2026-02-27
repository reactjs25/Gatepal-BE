const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { ROLE_TYPES } = require('../../utils/userRoleUtils');
const { normalizeDigits } = require('../../utils/phoneNumber');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');
const { OCCUPANT_TYPES, OCCUPANCY_STATUSES, toCanonicalOccupantType, toCanonicalOccupancyStatus } = require('../../utils/enums/memberEnums');

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

const maybeUpgradeSocietyAdmin = (user, society) => {
  if (!user || !society || user.role === ROLE_TYPES.SOCIETY_ADMIN) {
    return { upgraded: false };
  }

  const allowedUpgradeRoles = new Set([ROLE_TYPES.MEMBER, ROLE_TYPES.SOCIETY_ADMIN]);

  if (!allowedUpgradeRoles.has(user.role) && !allowedUpgradeRoles.has(user.intendedRole)) {
    return { upgraded: false };
  }

  const normalizedUserPhone = normalizeDigits(user.phoneNumber || '');

  const candidateAdmins = Array.isArray(society.societyAdmins) ? society.societyAdmins : [];

  const adminMatch = candidateAdmins.find((admin) => {
    if (!admin.mobile) {
      return false;
    }

    return normalizeDigits(admin.mobile) === normalizedUserPhone && admin.status !== 'Inactive';
  });

  if (!adminMatch) {
    return { upgraded: false };
  }

  user.role = ROLE_TYPES.SOCIETY_ADMIN;
  user.linkedSocietyAdminId = adminMatch._id;
  user.linkedSocietyAdminIds = Array.from(
    new Set([...(user.linkedSocietyAdminIds || []).map((id) => String(id)), String(adminMatch._id)])
  );
  if (!user.lastLoggedInSocietyId) {
    user.lastLoggedInSocietyId = society._id;
  }
  user.upgradedToSocietyAdminAt = new Date();

  return {
    upgraded: true,
    societyAdminId: adminMatch._id,
  };
};

const handleMemberOnboarding = async ({ user, payload }) => {
  const fullName = toTitleCaseName(getLastBodyValue(payload.fullName));
  const email = normalizeString(getLastBodyValue(payload.email));
  const country = normalizeString(getLastBodyValue(payload.country));
  const city = normalizeString(getLastBodyValue(payload.city));
  const societyName = normalizeString(getLastBodyValue(payload.societyName));
  const societyPin = normalizeString(getLastBodyValue(payload.societyPin));
  const wingName = normalizeString(
    getLastBodyValue(payload.wingName !== undefined ? payload.wingName : payload.wing)
  );
  const unitNumber = normalizeString(
    getLastBodyValue(
      payload.unitNumber !== undefined
        ? payload.unitNumber
        : payload.unnitNumber !== undefined
          ? payload.unnitNumber
          : payload.unit
    )
  );
  const occupantType = toCanonicalOccupantType(
    getLastBodyValue(
      payload.occupantType !== undefined
        ? payload.occupantType
        : payload.occupancyType !== undefined
          ? payload.occupancyType
          : payload.occupanytype
    )
  );
  let occupancyStatus = toCanonicalOccupancyStatus(getLastBodyValue(payload.occupancyStatus));

  if (!fullName || !email || !societyName || !societyPin || !wingName || !unitNumber) {
    throw createHttpError(
      'Full name, email, society name, society pin, wing, and unit details are required for onboarding.',
      400
    );
  }

  if (!country || !city) {
    throw createHttpError('Country and city are required for onboarding.', 400);
  }

  if (!OCCUPANT_TYPES.has(occupantType)) {
    throw createHttpError('Invalid occupant type provided.', 400);
  }

  if (!OCCUPANCY_STATUSES.has(occupancyStatus)) {
    if (occupantType === 'tenant' || occupantType === 'tenant_family_member') {
      occupancyStatus = 'unit_rented';
    } else {
      throw createHttpError('Invalid occupancy status provided.', 400);
    }
  }

  const normalizedSocietyName = societyName;
  const normalizedSocietyPin = societyPin;

  const society = await Society.findOne({
    societyName: normalizedSocietyName,
    societyPin: normalizedSocietyPin,
  });

  if (!society) {
    throw createHttpError('Society not found for provided name and pin.', 404);
  }

  user.fullName = fullName;
  user.email = email.toLowerCase();
  user.country = country || null;
  user.city = city || null;
  user.societyId = society._id;
  user.societyName = society.societyName;
  user.wingName = wingName;
  user.unitNumber = unitNumber;
  user.occupantType = occupantType;
  user.occupancyStatus = occupancyStatus;
  user.onboardingData = {
    ...(user.onboardingData || {}),
    member: {
      fullName: user.fullName,
      email: user.email,
      country: user.country,
      city: user.city,
      societyId: society._id,
      societyName: society.societyName,
      societyPin: society.societyPin,
      wingName: user.wingName,
      unitNumber: user.unitNumber,
      occupantType: user.occupantType,
      occupancyStatus: user.occupancyStatus,
    },
  };

  const [primaryOwner, primaryTenant] = await Promise.all([
    MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: user.wingName.toLowerCase(),
      unitNumberLower: user.unitNumber.toLowerCase(),
      occupantType: 'unit_owner',
    })
      .sort({ createdAt: 1 })
      .lean(),
    MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: user.wingName.toLowerCase(),
      unitNumberLower: user.unitNumber.toLowerCase(),
      occupantType: 'tenant',
    }).lean(),
  ]);

  if (user.occupantType === 'tenant') {
    if (primaryTenant) {
      throw createHttpError('A tenant is already registered for this unit.', 409);
    }
  }

  const exists = await MemberUnit.exists({
    memberId: user._id,
    societyId: society._id,
    wingNameLower: user.wingName.toLowerCase(),
    unitNumberLower: user.unitNumber.toLowerCase(),
  });

  if (!exists) {
    const payload = {
      memberId: user._id,
      societyId: society._id,
      wingName: user.wingName,
      wingNameLower: user.wingName.toLowerCase(),
      unitNumber: user.unitNumber,
      unitNumberLower: user.unitNumber.toLowerCase(),
      occupantType: user.occupantType,
      occupancyStatus: user.occupancyStatus,
      ...(user.occupantType === 'unit_owner_family_member' && primaryOwner
        ? { primaryMemberId: primaryOwner.memberId }
        : {}),
      ...(user.occupantType === 'tenant_family_member' && primaryTenant
        ? { primaryMemberId: primaryTenant.memberId }
        : {}),
    };

    try {
      await MemberUnit.create(payload);
    } catch (err) {
      if (err && err.code === 11000) {
        if (user.occupantType === 'tenant') {
          throw createHttpError('A tenant is already registered for this unit.', 409);
        }
        throw createHttpError('You already registered this unit for this society and wing.', 409);
      }
      throw err;
    }
  }

  const upgradeResult = maybeUpgradeSocietyAdmin(user, society);

  return { society, upgradeResult };
};

module.exports = {
  handleMemberOnboarding,
};

