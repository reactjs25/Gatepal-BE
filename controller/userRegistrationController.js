const mongoose = require('mongoose');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const { generateNumericOtp, sendOtpToPhone } = require('../utils/otpService');
const { createHttpError } = require('../utils/httpError');
const {
  ROLE_TYPES,
  normalizeRole,
  resolveOnboardingFlow,
} = require('../utils/userRoleUtils');
const {
  normalizePhoneNumber,
  normalizeCountryCode,
  normalizeDigits,
} = require('../utils/phoneNumber');
const { generateUserAuthToken } = require('../utils/authToken');

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);

const MEMBER_OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);

const MEMBER_OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);

const mapUserResponse = (user) => ({
  id: user._id,
  role: user.role,
  intendedRole: user.intendedRole,
  onboardingFlow: user.onboardingFlow,
  onboardingStatus: user.onboardingStatus,
  phoneNumber: user.phoneNumber,
  countryCode: user.countryCode,
  fullName: user.fullName,
  email: user.email,
  societyId: user.societyId,
  societyName: user.societyName,
  wingName: user.wingName,
  unitNumber: user.unitNumber,
  occupantType: user.occupantType,
  occupancyStatus: user.occupancyStatus,
  status: user.status,
});

const resolveStoredRoleForRegistration = (role) =>
  role === ROLE_TYPES.SOCIETY_ADMIN ? ROLE_TYPES.MEMBER : role;

const assertObjectId = (value, message) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(message, 400);
  }
};

const maybeUpgradeSocietyAdmin = (user, society) => {
  if (
    !user ||
    !society ||
    user.role === ROLE_TYPES.SOCIETY_ADMIN ||
    user.intendedRole !== ROLE_TYPES.SOCIETY_ADMIN
  ) {
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

const registerUser = async (req, res, next) => {
  try {
    const {
      role = ROLE_TYPES.MEMBER,
      countryCode,
      phoneNumber,
      password,
      confirmPassword,
      termsAccepted,
    } = req.body || {};

    if (!phoneNumber || !password || !confirmPassword) {
      throw createHttpError('Mobile number, password, and confirm password are required', 400);
    }

    if (password !== confirmPassword) {
      throw createHttpError('Password and confirm password do not match', 400);
    }

    if (!termsAccepted) {
      throw createHttpError('You must accept the terms to continue', 400);
    }

    const normalizedRole = normalizeRole(role);
    const storedRole = resolveStoredRoleForRegistration(normalizedRole);
    const normalizedPhone = normalizeDigits(normalizePhoneNumber(phoneNumber));

    if (!normalizedPhone) {
      throw createHttpError('Mobile number is required', 400);
    }

    const normalizedCountryCode = normalizeCountryCode(countryCode);

    let user = await User.findOne({
      role: storedRole,
      phoneNumber: normalizedPhone,
    });

    if (user && user.status === 'blocked') {
      throw createHttpError('This account has been blocked. Contact support.', 403);
    }

    if (user && user.status !== 'pending_otp') {
      throw createHttpError('An account with this mobile number already exists', 409);
    }

    if (!user) {
      user = new User({
        countryCode: normalizedCountryCode,
        phoneNumber: normalizedPhone,
        role: storedRole,
      });
    } else {
      user.countryCode = normalizedCountryCode;
      user.phoneNumber = normalizedPhone;
    }

    user.password = password;
    user.intendedRole = normalizedRole;
    user.onboardingFlow = resolveOnboardingFlow(normalizedRole);
    user.onboardingStatus = 'not_started';
    user.termsAcceptedAt = new Date();
    user.onboardingData = {};
    user.status = 'pending_otp';

    const otp = generateNumericOtp(4);
    user.setOtp(otp);

    await user.save();

    await sendOtpToPhone({
      countryCode: normalizedCountryCode,
      phoneNumber: normalizedPhone,
      otp,
    });

    const includeOtpInResponse = process.env.NODE_ENV !== 'production';

    return res.status(201).json({
      message: 'Registration initiated. Please verify the OTP to continue onboarding.',
      data: {
        userId: user._id,
        role: user.role,
        intendedRole: user.intendedRole,
        onboardingFlow: user.onboardingFlow,
        status: user.status,
        otpValidForMs: OTP_TTL_IN_MS,
        ...(includeOtpInResponse ? { otp } : {}),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to initiate registration';
    return next(error);
  }
};

const verifyRegistrationOtp = async (req, res, next) => {
  try {
    const { userId, otp } = req.body || {};

    if (!userId || !otp) {
      throw createHttpError('User ID and OTP are required', 400);
    }

    const user = await User.findById(userId);

    if (!user) {
      throw createHttpError('Account not found for the provided details', 404);
    }

    if (user.status !== 'pending_otp') {
      throw createHttpError('OTP verification is not required for this account', 400);
    }

    const isValid = user.verifyOtp(otp);

    if (!isValid) {
      throw createHttpError('Invalid or expired OTP', 400);
    }

    user.onboardingStatus = 'in_progress';
    await user.save();

    const token = generateUserAuthToken({
      id: user._id,
      role: user.role,
      extraClaims: user.societyId ? { societyId: user.societyId } : {},
    });

    return res.status(200).json({
      message: 'OTP verified successfully. Continue onboarding.',
      data: mapUserResponse(user),
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to verify OTP';
    return next(error);
  }
};

const handleMemberOnboarding = async ({ user, payload }) => {
  const {
    fullName,
    email,
    country,
    city,
    societyId,
    wingName,
    unitNumber,
    occupantType,
    occupancyStatus,
  } = payload;

  if (!fullName || !email || !societyId || !wingName || !unitNumber) {
    throw createHttpError(
      'Full name, email, society, wing, and unit details are required for onboarding',
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

  assertObjectId(societyId, 'Invalid society identifier provided');
  const society = await Society.findById(societyId);

  if (!society) {
    throw createHttpError('Society not found', 404);
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
      wingName: user.wingName,
      unitNumber: user.unitNumber,
      occupantType: user.occupantType,
      occupancyStatus: user.occupancyStatus,
    },
  };

  const upgradeResult = maybeUpgradeSocietyAdmin(user, society);

  return { society, upgradeResult };
};

const handleGuardOnboarding = async ({ user, payload }) => {
  const { fullName, email, societyId, assignedGate, shiftStart, shiftEnd, notes } = payload;

  if (!fullName) {
    throw createHttpError('Full name is required for guard onboarding', 400);
  }

  let society = null;

  if (societyId) {
    assertObjectId(societyId, 'Invalid society identifier provided');
    society = await Society.findById(societyId);
    if (!society) {
      throw createHttpError('Society not found', 404);
    }
  }

  user.fullName = fullName.trim();
  user.email = email?.trim().toLowerCase() || user.email;
  user.societyId = society ? society._id : null;
  user.societyName = society ? society.societyName : null;
  user.onboardingData = {
    ...(user.onboardingData || {}),
    guard: {
      fullName: user.fullName,
      email: user.email,
      societyId: society ? society._id : null,
      societyName: society ? society.societyName : null,
      assignedGate: assignedGate || null,
      shiftStart: shiftStart || null,
      shiftEnd: shiftEnd || null,
      notes: notes || null,
    },
  };

  return { society };
};

const handleVisitorOnboarding = async ({ user, payload }) => {
  const { fullName, email, visitingSocietyId, hostName, purpose, expectedVisitDate } = payload;

  if (!fullName || !hostName || !purpose) {
    throw createHttpError('Full name, host name, and visit purpose are required for visitors', 400);
  }

  let society = null;

  if (visitingSocietyId) {
    assertObjectId(visitingSocietyId, 'Invalid society identifier provided');
    society = await Society.findById(visitingSocietyId);
    if (!society) {
      throw createHttpError('Society not found', 404);
    }
  }

  user.fullName = fullName.trim();
  user.email = email?.trim().toLowerCase() || user.email;
  user.onboardingData = {
    ...(user.onboardingData || {}),
    visitor: {
      fullName: user.fullName,
      email: user.email,
      visitingSocietyId: society ? society._id : null,
      visitingSocietyName: society ? society.societyName : null,
      hostName: hostName.trim(),
      purpose: purpose.trim(),
      expectedVisitDate: expectedVisitDate || null,
    },
  };

  return { society };
};

const completeOnboarding = async (req, res, next) => {
  try {
    const user = req.appUser;

    if (!user) {
      throw createHttpError('Unauthorized', 401);
    }

    const flow = user.onboardingFlow || resolveOnboardingFlow(user.intendedRole || user.role);
    const payload = req.body || {};

    let upgradeResult = { upgraded: false };

    if (flow === 'member') {
      const result = await handleMemberOnboarding({ user, payload });
      upgradeResult = result.upgradeResult;
    } else if (flow === 'guard') {
      await handleGuardOnboarding({ user, payload });
    } else if (flow === 'visitor') {
      await handleVisitorOnboarding({ user, payload });
    } else {
      throw createHttpError('Unsupported onboarding flow', 400);
    }

    user.onboardedAt = new Date();
    user.onboardingStatus = 'completed';

    await user.save();

    const token = generateUserAuthToken({
      id: user._id,
      role: user.role,
      extraClaims: user.societyId ? { societyId: user.societyId } : {},
    });

    return res.status(200).json({
      message: 'Onboarding completed successfully',
      data: mapUserResponse(user),
      meta: {
        flow,
        roleUpgraded: upgradeResult.upgraded,
      },
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to complete onboarding';
    return next(error);
  }
};

module.exports = {
  registerUser,
  verifyRegistrationOtp,
  completeOnboarding,
};

