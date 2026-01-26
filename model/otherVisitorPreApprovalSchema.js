const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const otherVisitorPreApprovalSchema = new mongoose.Schema(
  {
    preApprovalId: {
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
    visitorType: {
      type: String,
      default: 'other_visitor',
      index: true,
    },
    visitorName: { type: String, trim: true, default: null },
    workCategory: { type: String, trim: true, required: true },
    companyName: { type: String, trim: true, default: null },
    isPrivateInvite: { type: Boolean, default: false },
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
  },
  { timestamps: true }
);

otherVisitorPreApprovalSchema.index({ societyId: 1, unitId: 1, validFrom: -1 });
otherVisitorPreApprovalSchema.index({ invitedByUserId: 1, createdAt: -1 });

module.exports = mongoose.model('OtherVisitorPreApproval', otherVisitorPreApprovalSchema);
