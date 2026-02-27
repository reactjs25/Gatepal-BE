const mongoose = require('mongoose');

const otherVisitorCompanySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, unique: true },
    imageUrl: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OtherVisitorCompany', otherVisitorCompanySchema);
