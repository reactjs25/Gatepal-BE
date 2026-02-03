const mongoose = require('mongoose');

/**
 * Tracks maintenance reminder notifications sent per unit per month.
 * This prevents sending duplicate reminders and tracks reminder history.
 */
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
    // Type of reminder: 'reminder' (before due) or 'overdue' (after due)
    reminderType: {
      type: String,
      enum: ['reminder', 'overdue'],
      required: true,
    },
    // Count of reminders sent for this unit/month
    reminderCount: {
      type: Number,
      default: 0,
    },
    // Dates when reminders were sent
    remindersSentAt: {
      type: [Date],
      default: [],
    },
    // Last reminder sent date (for quick querying)
    lastReminderSentAt: {
      type: Date,
      default: null,
    },
    // Whether maintenance was paid (to stop sending reminders)
    isPaid: {
      type: Boolean,
      default: false,
    },
    // Date when payment was confirmed
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
maintenanceReminderTrackingSchema.index({ societyId: 1, unitId: 1, year: 1, month: 1, reminderType: 1 }, { unique: true });
maintenanceReminderTrackingSchema.index({ societyId: 1, year: 1, month: 1 });
maintenanceReminderTrackingSchema.index({ lastReminderSentAt: 1 });

// TTL index - auto delete after 1 year
maintenanceReminderTrackingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('MaintenanceReminderTracking', maintenanceReminderTrackingSchema);
