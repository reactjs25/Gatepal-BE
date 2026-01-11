const mongoose = require('mongoose');

const missingUnitRequestSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Society', required: true, index: true },
    societyPin: { type: String, default: null },
    societyName: { type: String, default: null },
    city: { type: String, default: null },
    country: { type: String, default: null },

    wingName: { type: String, default: null, trim: true },
    wingNameLower: { type: String, default: null, lowercase: true, trim: true },

    unitNumber: { type: String, required: true, trim: true },
    unitNumberLower: { type: String, required: true, lowercase: true, trim: true },

    status: { type: String, enum: ['pending', 'resolved'], default: 'pending', index: true },

    requestCount: { type: Number, default: 1 },
    lastRequestedAt: { type: Date, default: Date.now },

    requestedByUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    requestedByPhones: [{ type: String }],
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

missingUnitRequestSchema.index(
  { societyId: 1, wingNameLower: 1, unitNumberLower: 1 },
  {
    unique: true,
    name: 'uniq_pending_missing_unit_per_society',
    partialFilterExpression: { status: 'pending' },
  }
);

missingUnitRequestSchema.index(
  { societyId: 1, status: 1, lastRequestedAt: -1 },
  { name: 'missing_unit_list_by_society' }
);

module.exports = mongoose.model('MissingUnitRequest', missingUnitRequestSchema);

