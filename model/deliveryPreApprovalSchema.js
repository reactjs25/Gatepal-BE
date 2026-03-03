const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const deliveryPreApprovalSchema = new mongoose.Schema(
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
      default: 'delivery_executive',
      index: true,
    },
    visitorName: { type: String, trim: true, default: null },
    companyId: { type: String, trim: true, default: null },
    companyName: { type: String, trim: true, default: null },
    companyImageUrl: { type: String, trim: true, default: null },
    isSilentDelivery: { type: Boolean, default: false },
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

deliveryPreApprovalSchema.index({ societyId: 1, unitId: 1, validFrom: -1 });
deliveryPreApprovalSchema.index({ invitedByUserId: 1, createdAt: -1 });

applyTitleCasePlugin(deliveryPreApprovalSchema, {
  paths: ['visitorName', 'companyName'],
});

module.exports = mongoose.model('DeliveryPreApproval', deliveryPreApprovalSchema);
