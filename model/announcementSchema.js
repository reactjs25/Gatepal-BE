const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const announcementSchema = new mongoose.Schema(
  {
    announcementId: { type: String, required: true, unique: true, default: () => randomUUID() },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Society', required: true, index: true },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    contentHtml: { type: String, required: true },
    photos: [{ type: String }],
    attachments: [{ type: String }],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

announcementSchema.index(
  { societyId: 1, deletedAt: 1, createdAt: -1 },
  { name: 'idx_announcements_by_society' }
);

module.exports = mongoose.model('Announcement', announcementSchema);

