const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const societyRuleSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, unique: true, default: () => randomUUID() },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Society', required: true, index: true },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    categoryKey: { type: String, required: true, index: true },
    contentHtml: { type: String, required: true },
    photos: { type: [String], default: [] },
    attachments: { type: [String], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

societyRuleSchema.index(
  { societyId: 1, categoryKey: 1, deletedAt: 1, createdAt: -1 },
  { name: 'idx_society_rules_by_society_and_category' }
);

module.exports = mongoose.model('SocietyRule', societyRuleSchema);

