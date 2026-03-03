const mongoose = require('mongoose');

const DailyHelpSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    category: { type: String, required: true, index: true },
    name: { type: String, required: true },
    countryCode: { type: String, default: '+91' },
    phoneNumber: { type: String, default: null },
    phoneDigits: { type: String, default: null },
    comparablePhone: { type: String, default: null, index: true },
    imageUrl: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'],
      default: 'PENDING',
      index: true,
    },
    rejectReasonCode: { type: String, default: null },
    rejectReasonText: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    removedAt: { type: Date, default: null },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdByRole: { type: String, required: true },
  },
  { timestamps: true }
);

DailyHelpSchema.index({ societyId: 1, category: 1, phoneDigits: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('DailyHelp', DailyHelpSchema);

