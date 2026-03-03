const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const PET_TYPES = ['Dog', 'Cat', 'Parrot', 'Rabbit', 'Hamsters', 'Others'];
const VACCINATION_STATUSES = [
  'Fully Vaccinated',
  'Partially Vaccinated',
  'Not Vaccinated',
  'Vaccination Not Required',
];

const petSchema = new mongoose.Schema(
  {
    petId: { type: String, required: true, unique: true, default: () => randomUUID() },
    unitId: { type: String, required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    petType: { type: String, required: true, enum: PET_TYPES },
    name: { type: String, required: true, trim: true },
    vaccinationStatus: { type: String, required: true, enum: VACCINATION_STATUSES },
    lastVaccinationDate: { type: Date, default: null },
    nextVaccinationDueDate: { type: Date, default: null },
    certificateUrl: { type: String, default: null, trim: true },
    certificateFileName: { type: String, default: null, trim: true },
    certificateMimeType: { type: String, default: null, trim: true },
    certificateFileSize: { type: Number, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

petSchema.index({ unitId: 1, name: 1, petType: 1 }, {
  unique: true,
  name: 'uniq_pet_name_type_per_unit',
  partialFilterExpression: { deletedAt: null },
});

module.exports = mongoose.model('Pet', petSchema);
