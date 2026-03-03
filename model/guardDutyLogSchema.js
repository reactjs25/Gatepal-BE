const mongoose = require('mongoose');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const guardDutyLogSchema = new mongoose.Schema(
  {
    guardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    guardName: {
      type: String,
      trim: true,
      required: true,
    },
    guardPhone: {
      type: String,
      trim: true,
      default: null,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
    },
    societyName: {
      type: String,
      trim: true,
      default: null,
    },
    gateId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    gateName: {
      type: String,
      trim: true,
      default: null,
    },
    logType: {
      type: String,
      enum: ['duty_start', 'duty_end'],
      required: true,
    },
    autoEndDuty: {
      type: Boolean,
      default: false,
    },
    logTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true }
);


guardDutyLogSchema.index({ societyId: 1, logTime: -1 });
guardDutyLogSchema.index({ guardId: 1, logTime: -1 });

applyTitleCasePlugin(guardDutyLogSchema, {
  paths: ['guardName'],
});

module.exports = mongoose.model('GuardDutyLog', guardDutyLogSchema);
