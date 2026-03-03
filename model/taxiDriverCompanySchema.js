const mongoose = require('mongoose');

const taxiDriverCompanySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, unique: true },
    imageUrl: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TaxiDriverCompany', taxiDriverCompanySchema);
