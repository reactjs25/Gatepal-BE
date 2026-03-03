const mongoose = require('mongoose');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const FAMILY_CATEGORIES = ['adult', 'child'];

const familyMemberSchema = new mongoose.Schema(
  {
    unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'MemberUnit', required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true, enum: FAMILY_CATEGORIES },
    name: { type: String, required: true, trim: true },
    countryCode: { type: String, default: '+91', trim: true },
    phoneNumber: { type: String, default: null, trim: true },
    phoneDigits: {
      type: String,
      default: null,
      index: true,
      validate: {
        validator: (v) => v == null || /^\d{10,12}$/.test(v),
        message: 'Please enter a valid phone number',
      },
    },
    comparablePhone: { type: String, default: null, index: true },
    imageUrl: { type: String, default: null },
    status: { type: String, enum: ['Active on GatePal™', 'Inactive on GatePal™'], default: 'Inactive on GatePal™' },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

familyMemberSchema.index({ comparablePhone: 1 }, {
  unique: true,
  name: 'uniq_family_comparable_phone_global',
  partialFilterExpression: { comparablePhone: { $type: 'string' } },
});

applyTitleCasePlugin(familyMemberSchema, {
  paths: ['name'],
});

module.exports = mongoose.model('FamilyMember', familyMemberSchema);

