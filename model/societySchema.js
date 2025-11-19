const mongoose = require('mongoose');

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
        mobile: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
        password: { type: String },
        resetPasswordToken: { type: String, default: null },
        resetPasswordExpires: { type: Date, default: null },
    },
    { timestamps: true }
);

const engagementSchema = new mongoose.Schema({
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    baseRate: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
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
        status: { type: String, enum: ['Active', 'Inactive', 'Trial'], default: 'Active' },
        maintenanceDueDate: { type: Number, required: true },
        notes: { type: String },
        structure: [wingSchema],
        entryGates: [gateSchema],
        exitGates: [gateSchema],
        societyAdmins: [societyAdminSchema],
        engagement: engagementSchema,
    },
    { timestamps: true }
);

module.exports = mongoose.model('Society', societySchema);
