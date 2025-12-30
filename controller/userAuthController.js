const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../model/userSchema');
const { generateNumericOtp } = require('../utils/otpService');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { ROLE_TYPES, normalizeRole, APP_USER_ROLES } = require('../utils/userRoleUtils');
const { normalizePhoneNumber, normalizeCountryCode, normalizeDigits } = require('../utils/phoneNumber');
const { generateUserAuthToken } = require('../utils/authToken');
const { findSocietyAdminByPhone } = require('../utils/societyAdminUtils');
const { sendSuccessResponse } = require('../utils/response');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);
const PASSWORD_RESET_TOKEN_TTL = parseInt(process.env.PASSWORD_RESET_TOKEN_TTL || '3600000', 10);

const findPrincipal = async ({ role, countryCode, phoneNumber }) => {
  const normalizedRole = normalizeRole(role);
  const rawPhone = normalizePhoneNumber(String(phoneNumber || ''));
  const digitsOnly = normalizeDigits(rawPhone);

  if (!digitsOnly) {
    throw createHttpError('Phone number is required', 400);
  }

  const normalizedCountryCode = normalizeCountryCode(countryCode);

  const match = await findSocietyAdminByPhone(digitsOnly);

  if (match) {
    return {
      type: ROLE_TYPES.SOCIETY_ADMIN,
      role: ROLE_TYPES.SOCIETY_ADMIN,
      countryCode: normalizedCountryCode,
      doc: match.admin,
      society: match.society,
      save: () => match.society.save(),
    };
  }

  if (APP_USER_ROLES.has(normalizedRole)) {
    const query = {
      role: normalizedRole,
      phoneNumber: digitsOnly,
    };

    if (normalizedCountryCode) {
      query.countryCode = normalizedCountryCode;
    }

    let user = await User.findOne(query);

    if (!user) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: digitsOnly,
      });
    }

    if (!user && rawPhone && rawPhone !== digitsOnly) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: rawPhone,
        ...(normalizedCountryCode ? { countryCode: normalizedCountryCode } : {}),
      });
    }

    if (!user && rawPhone && rawPhone !== digitsOnly) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: rawPhone,
      });
    }

    if (!user) {
      user = await User.findOne({ phoneNumber: digitsOnly });
    }

    if (!user && rawPhone) {
      user = await User.findOne({ phoneNumber: rawPhone });
    }

    if (user && !APP_USER_ROLES.has(user.role)) {
      user = null;
    }

    if (user) {
      return {
        type: 'user',
        role: user.role,
        countryCode: normalizedCountryCode,
        doc: user,
        save: () => user.save(),
      };
    }
  }

  return null;
};

const mapPrincipalResponse = (principal) => {
  if (principal.type === 'user') {
    return {
      id: principal.doc._id,
      role: principal.doc.role,
      phoneNumber: principal.doc.phoneNumber,
      countryCode: principal.doc.countryCode,
      status: principal.doc.status,
    };
  }

  return {
    id: principal.doc._id,
    role: ROLE_TYPES.SOCIETY_ADMIN,
    phoneNumber: principal.doc.mobile,
    countryCode: principal.doc.countryCode || principal.countryCode,
    status: principal.doc.status,
    societyId: principal.society?._id,
    societyName: principal.society?.societyName,
  };
};

const ensureAccountIsActive = (principal) => {
  if (principal.type === 'user') {
    if (principal.doc.status === 'blocked') {
      throw createHttpError('Your account has been blocked. Contact support.', 403);
    }

    if (principal.doc.status === 'pending_otp') {
      throw createHttpError('Please verify the OTP sent to your number before logging in.', 403);
    }

    if (principal.doc.onboardingStatus !== 'completed') {
      throw createHttpError('Please complete onboarding before logging in.', 403);
    }

    return;
  }

  if (principal.doc.status === 'Inactive') {
    throw createHttpError('Your society admin account is inactive.', 403);
  }
};

const login = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, password } = req.body;

    if (!role || !phoneNumber || !password) {
      throw createHttpError('Role, phone number, and password are required', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details', 404);
    }

    ensureAccountIsActive(principal);

    let isPasswordValid = false;

    if (principal.type === 'user') {
      isPasswordValid = await principal.doc.comparePassword(password);
    } else {
      const adminDoc = principal.doc;
      const adminHasPassword = Boolean(adminDoc.password);

      if (adminHasPassword) {
        isPasswordValid = await bcrypt.compare(password, adminDoc.password || '');
      } else {
        const digits = normalizeDigits(adminDoc.mobile || '');
        const fallbackUser = await User.findOne({ phoneNumber: digits });

        if (fallbackUser) {
          isPasswordValid = await bcrypt.compare(password, fallbackUser.password || '');

          if (isPasswordValid) {
            if (!adminDoc.password) {
              adminDoc.password = fallbackUser.password;
              await principal.save();
            }

            if (!fallbackUser.linkedSocietyAdminId) {
              fallbackUser.linkedSocietyAdminId = adminDoc._id;
              if (!fallbackUser.upgradedToSocietyAdminAt) {
                fallbackUser.upgradedToSocietyAdminAt = new Date();
              }
              await fallbackUser.save();
            }
          }
        } else {
          isPasswordValid = await bcrypt.compare(password, adminDoc.password || '');
        }
      }
    }

    if (!isPasswordValid) {
      throw createHttpError('Invalid credentials', 401);
    }

    const token = generateUserAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    return sendSuccessResponse(res, 200, 'Login successful', {
      data: mapPrincipalResponse(principal),
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to login'));
  }
};

const requestPasswordOtp = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber } = req.body;

    if (!role || !phoneNumber) {
      throw createHttpError('Role and mobile number are required', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details', 404);
    }

    ensureAccountIsActive(principal);

    const otp = generateNumericOtp(4);
    if (principal.type === 'user') {
      principal.doc.setOtp(otp, { markPendingStatus: false });
    } else {
      principal.doc.setOtp(otp);
    }
    principal.doc.resetPasswordToken = null;
    principal.doc.resetPasswordExpires = null;

    await principal.save();

    return sendSuccessResponse(res, 200, 'OTP sent successfully', {
      data: {
        otpValidForMs: OTP_TTL_IN_MS,
        otp,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to send OTP'));
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, otp } = req.body;

    if (!role || !phoneNumber || !otp) {
      throw createHttpError('Role, mobile number, and OTP are required', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details', 404);
    }

    ensureAccountIsActive(principal);

    const isValid = principal.doc.verifyOtp(otp);

    if (!isValid) {
      throw createHttpError('Invalid or expired OTP', 400);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    principal.doc.resetPasswordToken = hashedToken;
    principal.doc.resetPasswordExpires = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL);

    await principal.save();

    return sendSuccessResponse(res, 200, 'OTP verified successfully', {
      data: {
        resetToken,
        resetTokenExpiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to verify OTP'));
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, password, resetToken } = req.body;

    if (!role || !phoneNumber || !password || !resetToken) {
      throw createHttpError('Role, mobile number, password, and reset token are required', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details', 404);
    }

    ensureAccountIsActive(principal);

    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const tokenMatches =
      principal.doc.resetPasswordToken === hashedToken &&
      principal.doc.resetPasswordExpires &&
      principal.doc.resetPasswordExpires.getTime() > Date.now();

    if (!tokenMatches) {
      throw createHttpError('Invalid or expired reset token', 400);
    }

    if (principal.type === 'user') {
      principal.doc.password = password;
    } else {
      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      principal.doc.password = await bcrypt.hash(password, salt);
    }

    principal.doc.resetPasswordToken = null;
    principal.doc.resetPasswordExpires = null;

    await principal.save();

    const token = generateUserAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    return sendSuccessResponse(res, 200, 'Password reset successful', {
      data: mapPrincipalResponse(principal),
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to reset password'));
  }
};

module.exports = {
  login,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
};


