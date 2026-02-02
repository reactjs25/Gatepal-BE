const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Not required if it's a society admin notification
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      index: true,
    },
    // For society admin notifications
    isSocietyAdmin: {
      type: Boolean,
      default: false,
    },
    societyAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        'announcement',
        'meeting',
        'maintenance',
        'visitor',
        'guest_entry',
        'daily_help',
        'society_rule',
        'general',
      ],
      default: 'general',
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    fcmStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
    },
    fcmMessageId: {
      type: String,
      default: null,
    },
    fcmError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ societyAdminId: 1, createdAt: -1 });


notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
