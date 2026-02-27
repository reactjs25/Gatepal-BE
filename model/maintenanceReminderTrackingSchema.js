const mongoose = require('mongoose');





const maintenanceReminderTrackingSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      index: true,
    },
    unitId: {
      type: String,
      required: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
    },
    month: {
      type: String,
      required: true,
      enum: [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ],
    },
    
    reminderType: {
      type: String,
      enum: ['reminder', 'overdue'],
      required: true,
    },
    
    reminderCount: {
      type: Number,
      default: 0,
    },
    
    remindersSentAt: {
      type: [Date],
      default: [],
    },
    
    lastReminderSentAt: {
      type: Date,
      default: null,
    },
    
    isPaid: {
      type: Boolean,
      default: false,
    },
    
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


maintenanceReminderTrackingSchema.index({ societyId: 1, unitId: 1, year: 1, month: 1, reminderType: 1 }, { unique: true });
maintenanceReminderTrackingSchema.index({ societyId: 1, year: 1, month: 1 });
maintenanceReminderTrackingSchema.index({ lastReminderSentAt: 1 });


maintenanceReminderTrackingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('MaintenanceReminderTracking', maintenanceReminderTrackingSchema);
