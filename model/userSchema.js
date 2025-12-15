const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10); // default 5 minutes
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

const MEMBER_OCCUPANT_TYPES = [
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
];

const MEMBER_OCCUPANCY_STATUSES = ['currently_residing', 'unit_rented', 'unit_vacant'];

const VISITOR_TYPES = ['guest', 'delivery_executive', 'taxi_vehicle_driver', 'other_visitor'];

const ONBOARDING_FLOWS = ['member', 'guard', 'visitor'];
const INTENDED_ROLE_TYPES = ['member', 'society_admin', 'guard', 'visitor'];
const ONBOARDING_STATUS_TYPES = ['not_started', 'in_progress', 'completed'];

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
      unique: true,
      minlength: 10,
      maxlength: 10,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    role: {
      type: String,
      required: true,
      enum: ['member', 'visitor', 'guard', 'society_admin'],
    },
    intendedRole: {
      type: String,
      enum: INTENDED_ROLE_TYPES,
      default: 'member',
    },
    onboardingFlow: {
      type: String,
      enum: ONBOARDING_FLOWS,
      default: 'member',
    },
    onboardingStatus: {
      type: String,
      enum: ONBOARDING_STATUS_TYPES,
      default: 'not_started',
    },
    onboardingData: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    fullName: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    country: {
      type: String,
      trim: true,
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      default: null,
    },
    societyName: {
      type: String,
      trim: true,
      default: null,
    },
    wingName: {
      type: String,
      trim: true,
      default: null,
    },
    unitNumber: {
      type: String,
      trim: true,
      default: null,
    },
    occupantType: {
      type: String,
      enum: MEMBER_OCCUPANT_TYPES,
      default: null,
    },
    occupancyStatus: {
      type: String,
      enum: MEMBER_OCCUPANCY_STATUSES,
      default: null,
    },
    visitorType: {
      type: String,
      enum: VISITOR_TYPES,
      default: null,
    },
    visitorCompanyName: {
      type: String,
      trim: true,
      default: null,
    },
    visitorVehicleNumber: {
      type: String,
      trim: true,
      default: null,
    },
    visitorWorkCategory: {
      type: String,
      trim: true,
      default: null,
    },
    profilePhoto: {
      type: String,
      default: null,
    },
    profilePhotoCapturedAt: {
      type: Date,
      default: null,
    },
    qrCodeImage: {
      type: String,
      default: null,
    },
    qrCodeGeneratedAt: {
      type: Date,
      default: null,
    },
    linkedSocietyAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    upgradedToSocietyAdminAt: {
      type: Date,
      default: null,
    },
    onboardedAt: {
      type: Date,
      default: null,
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
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
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

userSchema.methods.setOtp = function setOtp(otp, options = {}) {
  const { markPendingStatus = true } = options;
  const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
  this.otpCode = hashedOtp;
  this.otpExpiresAt = new Date(Date.now() + OTP_TTL_IN_MS);
  if (markPendingStatus) {
    this.status = 'pending_otp';
  }
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

