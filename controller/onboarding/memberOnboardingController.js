const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { ROLE_TYPES } = require('../../utils/userRoleUtils');
const { normalizeDigits } = require('../../utils/phoneNumber');

const MEMBER_OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);

const MEMBER_OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);

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
  user.upgradedToSocietyAdminAt = new Date();

  return {
    upgraded: true,
    societyAdminId: adminMatch._id,
  };
};

const handleMemberOnboarding = async ({ user, payload }) => {
  const fullName = normalizeString(payload.fullName);
  const email = normalizeString(payload.email);
  const country = normalizeString(payload.country);
  const city = normalizeString(payload.city);
  const societyName = normalizeString(payload.societyName);
  const societyPin = normalizeString(payload.societyPin);
  const wingName = normalizeString(payload.wingName ?? payload.wing);
  const unitNumber = normalizeString(payload.unitNumber ?? payload.unnitNumber ?? payload.unit);
  const occupantType = toCanonicalEnum(
    payload.occupantType ?? payload.occupancyType ?? payload.occupanytype,
    MEMBER_OCCUPANT_TYPES
  );
  let occupancyStatus = toCanonicalEnum(payload.occupancyStatus, MEMBER_OCCUPANCY_STATUSES);

  if (!fullName || !email || !societyName || !societyPin || !wingName || !unitNumber) {
    throw createHttpError(
      'Full name, email, society name, society pin, wing, and unit details are required for onboarding',
      400
    );
  }

  if (!country || !city) {
    throw createHttpError('Country and city are required for onboarding', 400);
  }

  if (!MEMBER_OCCUPANT_TYPES.has(occupantType)) {
    throw createHttpError('Invalid occupant type provided', 400);
  }

  if (!MEMBER_OCCUPANCY_STATUSES.has(occupancyStatus)) {
    if (occupantType === 'tenant' || occupantType === 'tenant_family_member') {
      occupancyStatus = 'unit_rented';
    } else {
      throw createHttpError('Invalid occupancy status provided', 400);
    }
  }

  const normalizedSocietyName = societyName;
  const normalizedSocietyPin = societyPin;

  const society = await Society.findOne({
    societyName: normalizedSocietyName,
    societyPin: normalizedSocietyPin,
  });

  if (!society) {
    throw createHttpError('Society not found for provided name and pin', 404);
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

  const primaryOwner = await MemberUnit.findOne({
    societyId: society._id,
    wingNameLower: user.wingName.toLowerCase(),
    unitNumberLower: user.unitNumber.toLowerCase(),
    occupantType: 'unit_owner',
  })
    .sort({ createdAt: 1 })
    .lean();

  const primaryTenant = await MemberUnit.findOne({
    societyId: society._id,
    wingNameLower: user.wingName.toLowerCase(),
    unitNumberLower: user.unitNumber.toLowerCase(),
    occupantType: 'tenant',
  }).lean();

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

    await MemberUnit.create(payload);
  }

  const upgradeResult = maybeUpgradeSocietyAdmin(user, society);

  return { society, upgradeResult };
};

module.exports = {
  handleMemberOnboarding,
};

