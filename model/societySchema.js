const mongoose = require('mongoose');
const crypto = require('crypto');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);

const unitSchema = new mongoose.Schema({
    unitNumber: { type: String, required: true },
});

const wingSchema = new mongoose.Schema({
    wingName: { type: String, required: true },
    totalUnits: { type: Number, required: true },
    units: [unitSchema],
});

const gateSchema = new mongoose.Schema({
    name: { type: String, required: true },
});

const societyAdminSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 150 },
        mobile: { type: String, required: true, minlength: 10, maxlength: 12, match: /^\d{10,12}$/ },
        countryCode: { type: String, trim: true, default: '+91' },
        email: { type: String, required: true },
        status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
        password: { type: String },
        resetPasswordToken: { type: String, default: null },
        resetPasswordExpires: { type: Date, default: null },
        otpCode: { type: String, default: null },
        otpExpiresAt: { type: Date, default: null },
        otpVerifiedAt: { type: Date, default: null },
        
        wingName: { type: String, trim: true, default: null },
        unitNumber: { type: String, trim: true, default: null },
        fcmTokens: {
            type: [{
                token: { type: String, required: true },
                deviceType: {
                    type: String,
                    enum: ['android', 'ios', 'web'],
                    default: 'android',
                },
                deviceId: { type: String, default: null },
                createdAt: { type: Date, default: Date.now },
            }],
            default: [],
        },
    },
    { timestamps: true }
);

societyAdminSchema.methods.setOtp = function setOtp(otp) {
    const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
    this.otpCode = hashedOtp;
    this.otpExpiresAt = new Date(Date.now() + OTP_TTL_IN_MS);
};

societyAdminSchema.methods.verifyOtp = function verifyOtp(otp) {
    if (!this.otpCode || !this.otpExpiresAt) {
        return false;
    }

    const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
    const isValid = hashedOtp === this.otpCode && this.otpExpiresAt.getTime() > Date.now();

    if (isValid) {
        this.otpCode = null;
        this.otpExpiresAt = null;
        this.otpVerifiedAt = new Date();
    }

    return isValid;
};

const engagementSchema = new mongoose.Schema({
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    baseRate: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
});

const vehicleLimitsSchema = new mongoose.Schema({
    twoWheelersPerUnit: { type: Number, default: 0, min: 0 },
    fourWheelersPerUnit: { type: Number, default: 0, min: 0 },
    otherVehiclesPerUnit: { type: Number, default: 0, min: 0 },
});

const societySchema = new mongoose.Schema(
    {
        societyName: { type: String, required: true },
        societyPin: { type: String, required: true, unique: true },
        address: { type: String, required: true },
        city: { type: String, required: true },
        country: { type: String, required: true },
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        status: { type: String, enum: ['Active', 'Inactive', 'Trial', 'Suspended'], default: 'Active' },
        maintenanceDueDate: { type: Number, required: true },
        notes: { type: String },
        structure: [wingSchema],
        entryGates: [gateSchema],
        exitGates: [gateSchema],
        societyAdmins: [societyAdminSchema],
        engagement: engagementSchema,
        vehicleLimits: vehicleLimitsSchema,
        
        lastContractExpiryNotificationAt: { type: Date, default: null },
        lastAppInactiveNotificationAt: { type: Date, default: null },
        contractExpiryNotificationCount: { type: Number, default: 0 },
        appInactiveNotificationCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

societySchema.index(
  { 'societyAdmins.resetPasswordToken': 1, 'societyAdmins.resetPasswordExpires': 1 },
  { partialFilterExpression: { 'societyAdmins.resetPasswordToken': { $type: 'string' } } }
);

applyTitleCasePlugin(societySchema, {
        paths: ['societyName', 'structure.wingName', 'entryGates.name', 'exitGates.name', 'societyAdmins.name', 'societyAdmins.wingName'],
});

module.exports = mongoose.model('Society', societySchema);
