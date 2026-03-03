const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const guestEntryRequestDraftSchema = new mongoose.Schema(
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
    createdByGuardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    gateId: { type: mongoose.Schema.Types.ObjectId, default: null },
    gateName: { type: String, trim: true, default: null },
    wingName: { type: String, trim: true, required: true },
    unitNumbers: { type: [String], required: true, default: [] },
    unitTargets: {
      type: [
        new mongoose.Schema(
          {
            wingName: { type: String, trim: true, required: true },
            unitNumber: { type: String, trim: true, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    guestName: { type: String, trim: true, required: true },
    guestCountryCode: { type: String, trim: true, default: '+91' },
    guestPhoneNumber: { type: String, trim: true, required: true },
    guestPhoneDigits: { type: String, trim: true, required: true },
    visitorType: { type: String, trim: true, required: true },
    visitorCompanyName: { type: String, trim: true, default: null },
    visitorWorkCategory: { type: String, trim: true, default: null },
    accompanyingCount: { type: Number, default: 0 },
    vehicleNumber: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

guestEntryRequestDraftSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

applyTitleCasePlugin(guestEntryRequestDraftSchema, {
  paths: ['guestName', 'visitorCompanyName'],
});

module.exports = mongoose.model('GuestEntryRequestDraft', guestEntryRequestDraftSchema);
