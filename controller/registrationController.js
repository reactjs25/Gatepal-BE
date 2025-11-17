const User = require('../model/userSchema');
const { generateNumericOtp, sendOtpToPhone } = require('../utils/otpService');

const ALLOWED_ROLES = ['member', 'visitor', 'guard'];

const createHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
};

const sanitizePhoneNumber = (phoneNumber) =>
  String(phoneNumber || '')
    .replace(/\s+/g, '')
    .replace(/[^\d]/g, '');

const initiateRegistration = async (req, res, next) => {
  try {
    const {
      countryCode = '+91',
      phoneNumber,
      password,
      role,
      termsAccepted = false,
    } = req.body;

    if (!phoneNumber || !password || !role) {
      return next(createHttpError('Phone number, password, and role are required', 400));
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return next(createHttpError('Invalid role provided', 400));
    }

    if (!termsAccepted) {
      return next(createHttpError('Terms and conditions must be accepted', 400));
    }

    const normalizedPhone = sanitizePhoneNumber(phoneNumber);

    let user = await User.findOne({ phoneNumber: normalizedPhone, role });

    if (user && user.status === 'active') {
      return next(createHttpError('User already registered with this phone number and role', 409));
    }

    if (!user) {
      user = new User({
        countryCode,
        phoneNumber: normalizedPhone,
        password,
        role,
        termsAcceptedAt: new Date(),
      });
    } else {
      user.countryCode = countryCode;
      user.phoneNumber = normalizedPhone;
      user.password = password;
      user.termsAcceptedAt = new Date();
    }

    const otp = generateNumericOtp(4);
    user.setOtp(otp);
    await user.save();

    await sendOtpToPhone({ countryCode, phoneNumber: normalizedPhone, otp });

    return res.status(200).json({
      message: 'OTP sent successfully',
      data: {
        userId: user._id,
        role: user.role,
        phoneNumber: user.phoneNumber,
        otp, 
      },
    });
  } catch (error) {
    return next(error);
  }
};

const verifyRegistrationOtp = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return next(createHttpError('User ID and OTP are required', 400));
    }

    const user = await User.findById(userId);

    if (!user) {
      return next(createHttpError('User not found', 404));
    }

    const verified = user.verifyOtp(otp);

    if (!verified) {
      return next(createHttpError('Invalid or expired OTP', 400));
    }

    await user.save();

    return res.status(200).json({
      message: 'Registration completed successfully',
      data: {
        userId: user._id,
        role: user.role,
        phoneNumber: user.phoneNumber,
        status: user.status,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const resendRegistrationOtp = async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return next(createHttpError('User ID is required', 400));
    }

    const user = await User.findById(userId);

    if (!user) {
      return next(createHttpError('User not found', 404));
    }

    if (user.status === 'active') {
      return next(createHttpError('User is already verified', 400));
    }

    const otp = generateNumericOtp(4);
    user.setOtp(otp);
    await user.save();

    await sendOtpToPhone({
      countryCode: user.countryCode,
      phoneNumber: user.phoneNumber,
      otp,
    });

    return res.status(200).json({
      message: 'OTP resent successfully',
      data: {
        userId: user._id,
        role: user.role,
        phoneNumber: user.phoneNumber,
        otp, 
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  initiateRegistration,
  verifyRegistrationOtp,
  resendRegistrationOtp,
};


