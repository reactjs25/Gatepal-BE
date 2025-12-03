const mongoose = require('mongoose');
const MemberUnit = require('../model/memberUnitSchema');
const { createHttpError } = require('./httpError');

const normalizeString = (v) => (v || '').toString().trim();

const buildCanonicalUnitId = (unitDoc) => `${String(unitDoc.societyId)}:${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`;

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
    occupancyStatus: 'currently_residing',
  });

  if (!isResident) {
    throw createHttpError('Forbidden: only residents of this unit can delete pets', 403);
  }

  return unitDoc;
};

module.exports = {
  buildCanonicalUnitId,
  assertUnitAccess,
  assertMemberUnitOwnership,
  assertUnitResidentAccess,
};

