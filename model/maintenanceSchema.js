const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const maintenanceSchema = new mongoose.Schema(
  {
    maintenanceId: { type: String, required: true, unique: true, default: () => randomUUID() },
    unitId: { type: String, required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    year: { type: Number, required: true },
    month: { type: String, required: true, enum: MONTH_NAMES },
    amount: { type: Number, required: true },
    receiptNumber: { type: Number, default: null },
    receiptUrl: { type: String, default: null, trim: true },
    transactionDate: { type: Date, required: true },
    proofImageUrl: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ['Uploaded', 'Verified', 'Rejected'], default: 'Uploaded' },
    verifiedAt: { type: Date, default: null },
    verifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
    rejectionDescription: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

maintenanceSchema.index({ unitId: 1, year: 1, month: 1 }, {
  unique: true,
  name: 'uniq_maintenance_month_per_unit',
  partialFilterExpression: { deletedAt: null },
});

module.exports = mongoose.model('Maintenance', maintenanceSchema);
