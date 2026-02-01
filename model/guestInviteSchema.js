const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const GUEST_INVITE_TYPES = ['quick', 'group', 'frequent'];

const guestSchema = new mongoose.Schema(
  {
    guestId: {
      type: String,
      required: true,
      default: () => randomUUID(),
    },
    name: { type: String, required: true, trim: true },
    countryCode: { type: String, trim: true, default: '+91' },
    phoneNumber: { type: String, trim: true, default: null },
    phoneDigits: {
      type: String,
      default: null,
      index: true,
      validate: {
        validator: (v) => v == null || /^\d{10}$/.test(v),
        message: 'phoneNumber must contain exactly 10 digits',
      },
    },
    source: {
      type: String,
      enum: ['phonebook', 'manual', 'recent'],
      default: 'manual',
    },
    qrCodeImage: { type: String, default: null },
    qrCodeGeneratedAt: { type: Date, default: null },
    hasArrived: { type: Boolean, default: false },
    arrivedAt: { type: Date, default: null },
  },
  { _id: false }
);

const entryLogSchema = new mongoose.Schema(
  {
    guestId: { type: String, required: true },
    guestName: { type: String, trim: true, default: null },
    guestCountryCode: { type: String, trim: true, default: null },
    guestPhoneNumber: { type: String, trim: true, default: null },
    scannedAt: { type: Date, required: true, default: Date.now },
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    gateId: { type: mongoose.Schema.Types.ObjectId, default: null },
    gateName: { type: String, trim: true, default: null },
    vehicleNumber: { type: String, trim: true, default: null },
    accompanyingCount: { type: Number, default: 0 },
    imageUrl: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const guestInviteSchema = new mongoose.Schema(
  {
    inviteId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomUUID(),
      index: true,
    },
    type: {
      type: String,
      enum: GUEST_INVITE_TYPES,
      required: true,
      default: 'quick',
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      index: true,
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MemberUnit',
      required: true,
      index: true,
    },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    isPrivateInvite: {
      type: Boolean,
      default: false,
    },
    guests: {
      type: [guestSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one guest is required',
      },
    },
    qrCodeImage: { type: String, default: null },
    qrCodeGeneratedAt: { type: Date, default: null },
    validFrom: {
      type: Date,
      required: true,
      index: true,
    },
    validTill: {
      type: Date,
      required: true,
      index: true,
    },
    maxEntries: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },
    cancelledReason: { type: String, trim: true, default: null },
    cancelledDescription: { type: String, trim: true, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    entryLogs: {
      type: [entryLogSchema],
      default: [],
    },
  },
  { timestamps: true }
);

guestInviteSchema.index({ societyId: 1, unitId: 1, validFrom: -1 });
guestInviteSchema.index({ invitedByUserId: 1, createdAt: -1 });

module.exports = mongoose.model('GuestInvite', guestInviteSchema);

