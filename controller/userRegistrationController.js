const User = require('../model/userSchema');
const { generateNumericOtp, sendOtpToPhone } = require('../utils/otpService');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { ROLE_TYPES, normalizeRole, resolveOnboardingFlow } = require('../utils/userRoleUtils');
const { normalizePhoneNumber, normalizeCountryCode, normalizeDigits } = require('../utils/phoneNumber');
const { generateUserAuthToken } = require('../utils/authToken');
const { handleMemberOnboarding } = require('./onboarding/memberOnboardingController');
const { handleGuardOnboarding } = require('./onboarding/guardOnboardingController');
const { handleVisitorOnboarding } = require('./onboarding/visitorOnboardingController');
const { sendSuccessResponse } = require('../utils/response');
const SuperAdmin = require('../model/superAdminSchema');

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);
const buildPlaceholderEmail = (phoneNumber) => `pending+${phoneNumber}@gatepal.local`;

const mapUserResponse = (user) => ({
  id: user._id,
  role: user.role,
  onboardingStatus: user.onboardingStatus,
  phoneNumber: user.phoneNumber,
  countryCode: user.countryCode,
  name: user.fullName,
  imageUrl: user.profilePhoto,
  visitorType: user.visitorType,
  visitorCompanyName: user.visitorCompanyName,
  visitorVehicleNumber: user.visitorVehicleNumber,
  visitorWorkCategory: user.visitorWorkCategory,
  qrCodeImage: user.qrCodeImage,
  status: user.status,
});

const mapOtpVerificationResponse = (user) => ({
  id: user._id,
  role: user.role,
  onboardingStatus: user.onboardingStatus,
  phoneNumber: user.phoneNumber,
  countryCode: user.countryCode,
  status: user.status,
});

const resolveStoredRoleForRegistration = (role) =>
  role === ROLE_TYPES.SOCIETY_ADMIN ? ROLE_TYPES.MEMBER : role;

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
      throw createHttpError('Phone number, password, and confirm password are required', 400);
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
      throw createHttpError('Phone number is required', 400);
    }

    if (normalizedPhone.length !== 10) {
      throw createHttpError('Phone number must contain exactly 10 digits', 400);
    }

    const normalizedCountryCode = normalizeCountryCode(countryCode);

    let user = await User.findOne({ phoneNumber: normalizedPhone });

    if (user && user.status === 'blocked') {
      throw createHttpError('This account has been blocked. Contact support.', 403);
    }

    if (user && user.onboardingStatus === 'completed') {
      throw createHttpError('This phone number already exists in the system', 409);
    }

  
    const saExists = await SuperAdmin.exists({ phoneNumber: normalizedPhone });
    if (saExists) {
      throw createHttpError('This phone number already exists in the system', 409);
    }

    

    if (!user) {
      user = new User({
        countryCode: normalizedCountryCode,
        phoneNumber: normalizedPhone,
        role: storedRole,
      });
    }

    user.countryCode = normalizedCountryCode;
    user.phoneNumber = normalizedPhone;
    user.email = user.email || buildPlaceholderEmail(normalizedPhone);
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

    const includeOtpInResponse = true;

    return sendSuccessResponse(res, 201, 'Registration initiated. Please verify the OTP to continue onboarding.', {
      data: {
        userId: user._id,
        role: user.role,
        otpValidForMs: OTP_TTL_IN_MS,
        ...(includeOtpInResponse ? { otp } : {}),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to initiate registration'));
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

    return sendSuccessResponse(res, 200, 'OTP verified successfully. Continue onboarding.', {
      data: mapOtpVerificationResponse(user),
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to verify OTP'));
  }
};

const completeOnboarding = async (req, res, next) => {
  try {
    const user = req.appUser;

    if (!user) {
      throw createHttpError('Unauthorized', 401);
    }

    if (user.onboardingStatus === 'completed') {
      throw createHttpError('Onboarding already completed for this account', 409);
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

    return sendSuccessResponse(res, 200, 'Onboarding completed successfully.', {
      data: mapUserResponse(user),
      meta: {
        flow,
        roleUpgraded: upgradeResult.upgraded,
      },
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to complete onboarding'));
  }
};

module.exports = {
  registerUser,
  verifyRegistrationOtp,
  completeOnboarding,
};
