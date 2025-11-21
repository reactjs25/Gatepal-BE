const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const { generateNumericOtp } = require('../utils/otpService');
const { createHttpError } = require('../utils/httpError');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);
const PASSWORD_RESET_TOKEN_TTL = parseInt(process.env.PASSWORD_RESET_TOKEN_TTL || '3600000', 10);
const USER_JWT_EXPIRES_IN = process.env.USER_JWT_EXPIRES_IN || '7d';

const ROLE_TYPES = {
  MEMBER: 'member',
  VISITOR: 'visitor',
  GUARD: 'guard',
  SOCIETY_ADMIN: 'society_admin',
};

const USER_ROLES = new Set([ROLE_TYPES.MEMBER, ROLE_TYPES.VISITOR, ROLE_TYPES.GUARD]);

const normalizeRole = (rawRole = '') => {
  const sanitized = rawRole.trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (sanitized === 'security_guard') {
    return ROLE_TYPES.GUARD;
  }

  if (sanitized === 'society_admin') {
    return ROLE_TYPES.SOCIETY_ADMIN;
  }

  if (USER_ROLES.has(sanitized)) {
    return sanitized;
  }

  throw createHttpError('Unsupported role provided', 400);
};

const normalizePhoneNumber = (value = '') => value.trim();

const normalizeCountryCode = (value) => (value && value.trim() ? value.trim() : '+91');

const normalizeDigits = (value = '') => value.replace(/\D/g, '');

const generateAuthToken = ({ id, role, extraClaims = {} }) =>
  jwt.sign(
    {
      id,
      role,
      ...extraClaims,
    },
    process.env.JWT_SECRET,
    { expiresIn: USER_JWT_EXPIRES_IN }
  );

const findSocietyAdminByPhone = async (phoneNumber) => {
  const normalizedTarget = normalizeDigits(phoneNumber);
  if (!normalizedTarget) {
    return null;
  }

  const societies = await Society.find({ 'societyAdmins.mobile': { $exists: true, $ne: null } });

  for (const society of societies) {
    const admin = society.societyAdmins.find((candidate) => {
      if (!candidate.mobile) {
        return false;
      }

      return normalizeDigits(candidate.mobile) === normalizedTarget;
    });

    if (admin) {
      return { society, admin };
    }
  }

  return null;
};

const findPrincipal = async ({ role, countryCode, phoneNumber }) => {
  const normalizedRole = normalizeRole(role);
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhone) {
    throw createHttpError('Mobile number is required', 400);
  }

  const normalizedCountryCode = normalizeCountryCode(countryCode);

  if (USER_ROLES.has(normalizedRole)) {
    const query = {
      role: normalizedRole,
      phoneNumber: normalizedPhone,
    };

    if (normalizedCountryCode) {
      query.countryCode = normalizedCountryCode;
    }

    let user = await User.findOne(query);

    if (!user) {
      const digitsOnly = normalizeDigits(normalizedPhone);

      if (digitsOnly && digitsOnly !== normalizedPhone) {
        user = await User.findOne({
          role: normalizedRole,
          phoneNumber: digitsOnly,
          countryCode: normalizedCountryCode,
        });
      }
    }

    return user
      ? {
          type: 'user',
          role: normalizedRole,
          countryCode: normalizedCountryCode,
          doc: user,
          save: () => user.save(),
        }
      : null;
  }

  const match = await findSocietyAdminByPhone(normalizedPhone);

  return match
    ? {
        type: ROLE_TYPES.SOCIETY_ADMIN,
        role: ROLE_TYPES.SOCIETY_ADMIN,
        countryCode: normalizedCountryCode,
        doc: match.admin,
        society: match.society,
        save: () => match.society.save(),
      }
    : null;
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
      throw createHttpError('Role, mobile number, and password are required', 400);
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
      isPasswordValid = await bcrypt.compare(password, principal.doc.password || '');
    }

    if (!isPasswordValid) {
      throw createHttpError('Invalid credentials', 401);
    }

    const token = generateAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    return res.status(200).json({
      message: 'Login successful',
      data: mapPrincipalResponse(principal),
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to login';
    return next(error);
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

    const otp = generateNumericOtp(4);
    principal.doc.setOtp(otp);
    principal.doc.resetPasswordToken = null;
    principal.doc.resetPasswordExpires = null;

    await principal.save();

    return res.status(200).json({
      message: 'OTP sent successfully',
      data: {
        otpValidForMs: OTP_TTL_IN_MS,
        otp,
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to send OTP';
    return next(error);
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

    const isValid = principal.doc.verifyOtp(otp);

    if (!isValid) {
      throw createHttpError('Invalid or expired OTP', 400);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    principal.doc.resetPasswordToken = hashedToken;
    principal.doc.resetPasswordExpires = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL);

    await principal.save();

    return res.status(200).json({
      message: 'OTP verified successfully',
      data: {
        resetToken,
        resetTokenExpiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL,
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to verify OTP';
    return next(error);
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

    const token = generateAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    return res.status(200).json({
      message: 'Password reset successful',
      data: mapPrincipalResponse(principal),
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to reset password';
    return next(error);
  }
};

module.exports = {
  login,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
};


