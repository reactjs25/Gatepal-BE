const mongoose = require('mongoose');

const occupantTypes = ['unit_owner', 'unit_owner_family_member', 'tenant', 'tenant_family_member'];
const occupancyStatuses = ['currently_residing', 'unit_rented', 'unit_vacant'];

const memberUnitSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Society', required: true, index: true },
    wingName: { type: String, required: true, trim: true },
    wingNameLower: { type: String, required: true, lowercase: true, trim: true },
    unitNumber: { type: String, required: true, trim: true },
    unitNumberLower: { type: String, required: true, lowercase: true, trim: true },
    occupantType: { type: String, required: true, enum: occupantTypes },
    occupancyStatus: { type: String, required: true, enum: occupancyStatuses },
    primaryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

memberUnitSchema.index(
  { memberId: 1, societyId: 1, wingNameLower: 1, unitNumberLower: 1 },
  { unique: true, name: 'uniq_member_unit_per_society' }
);

memberUnitSchema.index(
  { societyId: 1, wingNameLower: 1, unitNumberLower: 1 },
  { name: 'lookup_unit_in_society' }
);

memberUnitSchema.index(
  { societyId: 1, wingNameLower: 1, unitNumberLower: 1 },
  {
    unique: true,
    name: 'uniq_primary_tenant_per_unit',
    partialFilterExpression: { occupantType: 'tenant' },
  }
);

module.exports = mongoose.model('MemberUnit', memberUnitSchema);
