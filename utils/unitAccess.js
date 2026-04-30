const mongoose = require('mongoose');
const MemberUnit = require('../model/memberUnitSchema');
const Society = require('../model/societySchema');
const { createHttpError } = require('./httpError');
const { assertSocietyIsAccessible } = require('./societyAccess');

const normalizeString = (v) => (v || '').toString().trim();

const buildCanonicalUnitId = (unitDoc) => `${String(unitDoc.societyId)}:${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`;

const assertUnitSocietyIsAccessible = async (unitDoc) => {
  const society = await Society.findById(unitDoc.societyId).lean();
  assertSocietyIsAccessible(society);
};

const assertUnitAccess = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const hasAccess = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
  });

  if (!hasAccess) {
    throw createHttpError('Forbidden: you do not have access to this unit', 403);
  }

  await assertUnitSocietyIsAccessible(unitDoc);

  return unitDoc;
};

const assertMemberUnitOwnership = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const isOwner = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
    occupantType: 'unit_owner',
  });

  if (!isOwner) {
    throw createHttpError('Forbidden: only unit owner can delete vehicles', 403);
  }

  await assertUnitSocietyIsAccessible(unitDoc);

  return unitDoc;
};

const assertUnitResidentAccess = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const isResident = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
    $or: [
      { occupancyStatus: 'currently_residing' },
      {
        occupancyStatus: 'unit_rented',
        occupantType: { $in: ['tenant', 'tenant_family_member'] },
      },
    ],
  });

  if (!isResident) {
    throw createHttpError('Forbidden: only residents of this unit can perform this action', 403);
  }

  await assertUnitSocietyIsAccessible(unitDoc);

  return unitDoc;
};

const assertUnitSocietyAdminAccess = async ({ unitId, adminSocietyId }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  if (!adminSocietyId || String(unitDoc.societyId) !== String(adminSocietyId)) {
    throw createHttpError('Forbidden: unit does not belong to your society', 403);
  }

  await assertUnitSocietyIsAccessible(unitDoc);

  return unitDoc;
};

const listSamePhysicalUnitIds = async (unitDoc) => {
  if (!unitDoc) return [];

  const matchingUnits = await MemberUnit.find(
    {
      societyId: unitDoc.societyId,
      wingNameLower: unitDoc.wingNameLower,
      unitNumberLower: unitDoc.unitNumberLower,
    },
    { _id: 1 }
  ).lean();

  if (!Array.isArray(matchingUnits) || matchingUnits.length === 0) {
    return unitDoc._id ? [unitDoc._id] : [];
  }

  return matchingUnits.map((unit) => unit._id);
};

module.exports = {
  buildCanonicalUnitId,
  assertUnitAccess,
  assertMemberUnitOwnership,
  assertUnitResidentAccess,
  assertUnitSocietyAdminAccess,
  listSamePhysicalUnitIds,
};
