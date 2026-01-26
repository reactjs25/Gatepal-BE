const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'entered', 'left', 'wrong_entry'];
const VISITOR_TYPES = ['guest', 'delivery_executive', 'taxi_vehicle_driver', 'other_visitor'];

const guestEntryRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomUUID(),
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      index: true,
    },
    // We deliberately store the unit by society+wing+unitNumber, because there can be multiple
    // MemberUnit docs (one per resident user) for the same physical unit.
    wingName: { type: String, required: true, trim: true },
    wingNameLower: { type: String, required: true, lowercase: true, trim: true, index: true },
    unitNumber: { type: String, required: true, trim: true },
    unitNumberLower: { type: String, required: true, lowercase: true, trim: true, index: true },

    createdByGuardId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gateId: { type: mongoose.Schema.Types.ObjectId, default: null },
    gateName: { type: String, trim: true, default: null },

    guestName: { type: String, required: true, trim: true },
    guestCountryCode: { type: String, trim: true, default: '+91' },
    guestPhoneNumber: { type: String, trim: true, required: true },
    guestPhoneDigits: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator: (v) => v == null || /^\d{10}$/.test(v),
        message: 'guestPhoneNumber must contain exactly 10 digits',
      },
    },
    guestImageUrl: { type: String, trim: true, default: null },

    // Visitor metadata (used for delivery executive / other visitor types)
    visitorType: { type: String, enum: VISITOR_TYPES, default: 'guest', index: true },
    visitorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    visitorCompanyName: { type: String, trim: true, default: null },
    visitorWorkCategory: { type: String, trim: true, default: null },

    accompanyingCount: { type: Number, default: 0 },
    vehicleNumber: { type: String, trim: true, default: null },

    status: { type: String, enum: REQUEST_STATUSES, default: 'pending', index: true },
    expiresAt: { type: Date, default: null, index: true },

    // Snapshot of who should receive the request (computed at creation time)
    recipientUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },

    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    rejectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },

    entryAllowedByGuardId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    entryAllowedAt: { type: Date, default: null },
    entryLeftByGuardId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    entryLeftByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    entryLeftAt: { type: Date, default: null },

    // Wrong entry tracking
    isWrongEntry: { type: Boolean, default: false },
    wrongEntryReason: { type: String, trim: true, default: null },
    wrongEntryDescription: { type: String, trim: true, default: null },
    wrongEntryMarkedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    wrongEntryMarkedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

guestEntryRequestSchema.index({ societyId: 1, wingNameLower: 1, unitNumberLower: 1, createdAt: -1 });

module.exports = mongoose.model('GuestEntryRequest', guestEntryRequestSchema);


