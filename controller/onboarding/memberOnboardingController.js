const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');
const { ROLE_TYPES } = require('../../utils/userRoleUtils');
const { normalizeDigits } = require('../../utils/phoneNumber');

const MEMBER_OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);

const MEMBER_OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);

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
  const {
    fullName,
    email,
    country,
    city,
    societyName,
    societyPin,
    wingName,
    unitNumber,
    occupantType,
    occupancyStatus,
  } = payload;

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
    throw createHttpError('Invalid occupancy status provided', 400);
  }

  const normalizedSocietyName = societyName?.trim();
  const normalizedSocietyPin = societyPin?.trim();

  const society = await Society.findOne({
    societyName: normalizedSocietyName,
    societyPin: normalizedSocietyPin,
  });

  if (!society) {
    throw createHttpError('Society not found for provided name and pin', 404);
  }

  user.fullName = fullName.trim();
  user.email = email.trim().toLowerCase();
  user.country = country?.trim() || null;
  user.city = city?.trim() || null;
  user.societyId = society._id;
  user.societyName = society.societyName;
  user.wingName = wingName.trim();
  user.unitNumber = unitNumber.trim();
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

  const upgradeResult = maybeUpgradeSocietyAdmin(user, society);

  return { society, upgradeResult };
};

module.exports = {
  handleMemberOnboarding,
};

