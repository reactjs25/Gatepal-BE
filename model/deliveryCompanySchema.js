const mongoose = require('mongoose');
const { applyTitleCasePlugin } = require('../utils/mongooseTitleCasePlugin');

const deliveryCompanySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, unique: true },
    imageUrl: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

applyTitleCasePlugin(deliveryCompanySchema, {
  paths: ['name'],
});

module.exports = mongoose.model('DeliveryCompany', deliveryCompanySchema);

