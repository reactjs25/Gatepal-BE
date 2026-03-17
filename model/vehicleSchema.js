const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const VEHICLE_TYPES = ['Two-Wheeler', 'Four-Wheeler', 'Other'];

const vehicleSchema = new mongoose.Schema(
  {
    vehicleId: { type: String, required: true, unique: true, default: () => randomUUID() },
    unitId: { type: String, required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleType: { type: String, required: true, enum: VEHICLE_TYPES },
    name: { type: String, required: true, trim: true },
    vehicleNumber: {
      type: String,
      required() {
        return !this.isElectric;
      },
      uppercase: true,
      trim: true,
    },
    isElectric: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vehicleSchema.index(
  { unitId: 1, vehicleNumber: 1 },
  {
    unique: true,
    name: 'uniq_vehicle_per_unit',
    partialFilterExpression: {
      deletedAt: null,
      vehicleNumber: { $exists: true, $type: 'string', $gt: '' },
    },
  }
);

module.exports = mongoose.model('Vehicle', vehicleSchema);

