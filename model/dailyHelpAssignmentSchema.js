const mongoose = require('mongoose');

const DailyHelpAssignmentSchema = new mongoose.Schema(
  {
    dailyHelpId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyHelp', required: true },
    unitId: { type: String, required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'],
      default: 'PENDING',
      index: true,
    },
    removedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

DailyHelpAssignmentSchema.index({ dailyHelpId: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.model('DailyHelpAssignment', DailyHelpAssignmentSchema);
