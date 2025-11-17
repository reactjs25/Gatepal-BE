const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10); // default 5 minutes
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

const userSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      trim: true,
      default: '+91',
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    role: {
      type: String,
      required: true,
      enum: ['member', 'visitor', 'guard'],
    },
    status: {
      type: String,
      enum: ['pending_otp', 'active', 'blocked'],
      default: 'pending_otp',
    },
    otpCode: {
      type: String,
      default: null,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
    },
    otpVerifiedAt: {
      type: Date,
      default: null,
    },
    termsAcceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.index({ phoneNumber: 1, role: 1 }, { unique: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.setOtp = function setOtp(otp) {
  const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
  this.otpCode = hashedOtp;
  this.otpExpiresAt = new Date(Date.now() + OTP_TTL_IN_MS);
  this.status = 'pending_otp';
};

userSchema.methods.verifyOtp = function verifyOtp(otp) {
  if (!this.otpCode || !this.otpExpiresAt) {
    return false;
  }

  const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
  const isValid = hashedOtp === this.otpCode && this.otpExpiresAt.getTime() > Date.now();

  if (isValid) {
    this.otpCode = null;
    this.otpExpiresAt = null;
    this.otpVerifiedAt = new Date();
    this.status = 'active';
  }

  return isValid;
};

module.exports = mongoose.model('User', userSchema);


