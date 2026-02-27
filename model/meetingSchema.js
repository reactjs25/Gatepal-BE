const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const meetingSchema = new mongoose.Schema(
  {
    meetingId: { type: String, required: true, unique: true, default: () => randomUUID() },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Society', required: true, index: true },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    meetingDate: { type: String, required: true, trim: true },
    meetingStartingFrom: { type: String, required: true, trim: true },
    venue: { type: String, required: true, trim: true },
    agendaHtml: { type: String, required: true },
    agendaPhotos: [{ type: String }],
    agendaAttachments: [{ type: String }],
    discussionHtml: { type: String, default: '' },
    discussionPhotos: [{ type: String }],
    discussionAttachments: [{ type: String }],
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

meetingSchema.index(
  { societyId: 1, deletedAt: 1, createdAt: -1 },
  { name: 'idx_meetings_by_society' }
);

module.exports = mongoose.model('Meeting', meetingSchema);

