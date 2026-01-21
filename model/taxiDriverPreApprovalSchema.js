const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const taxiDriverPreApprovalSchema = new mongoose.Schema(
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
      default: 'taxi_vehicle_driver',
      index: true,
    },
    companyId: { type: String, trim: true, default: null },
    companyName: { type: String, trim: true, required: true },
    companyImageUrl: { type: String, trim: true, default: null },
    vehicleNumber: { type: String, trim: true, default: null },
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
  },
  { timestamps: true }
);

taxiDriverPreApprovalSchema.index({ societyId: 1, unitId: 1, validFrom: -1 });
taxiDriverPreApprovalSchema.index({ invitedByUserId: 1, createdAt: -1 });

module.exports = mongoose.model('TaxiDriverPreApproval', taxiDriverPreApprovalSchema);
