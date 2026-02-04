const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      index: true,
    },
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
        "announcement",
        "meeting",
        "maintenance",
        "maintenance_reminder",
        "maintenance_overdue",
        "contract_expiring",
        "app_inactive",
        "visitor",
        "guest_entry",
        "guest_entry_request",
        "guest_entry_approved",
        "guest_entry_rejected",
        "guest_exit",
        "daily_help",
        "society_rule",
        "general",
      ],
      default: "general",
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Society information for rich notifications
    societyName: {
      type: String,
      default: null,
    },
    // Icon URL for notification (GatePal logo)
    iconUrl: {
      type: String,
      default: null,
    },
    // Large image URL for notification
    imageUrl: {
      type: String,
      default: null,
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
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
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
  },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ societyAdminId: 1, createdAt: -1 });

notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

module.exports = mongoose.model("Notification", notificationSchema);
