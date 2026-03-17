const Society = require('../model/societySchema');
const { createHttpError } = require('./httpError');
const { lookupSocietyAdminByMobile } = require('./societyAdminUtils');
const { assertSocietyIsAccessible, isSocietyAccessible } = require('./societyAccess');

const getEffectiveRole = (req, authUser) =>
  req?.user?.effectiveRole || authUser?.role || req?.user?.role || null;

const isScopedSocietyAdminSession = (req, authUser) => {
  const effectiveRole = getEffectiveRole(req, authUser);
  if (effectiveRole === 'society_admin') {
    return true;
  }

  return req?.user?.scope === 'app_user' && Boolean(req?.user?.societyAdminId);
};

const isSocietyAdminPrincipal = (req, authUser) => {
  const effectiveRole = getEffectiveRole(req, authUser);
  if (effectiveRole === 'society_admin') {
    return true;
  }

  if (req?.user?.societyAdminId) {
    return true;
  }

  if (authUser?.linkedSocietyAdminId) {
    return true;
  }

  return Array.isArray(authUser?.linkedSocietyAdminIds) && authUser.linkedSocietyAdminIds.length > 0;
};

const resolveAdminSocietyFromContext = async ({ req, authUser, allowPhoneFallback = true } = {}) => {
  if (!authUser) {
    throw createHttpError('Unauthorized.', 401);
  }

  const scopedSocietyId = req?.user?.societyId || null;
  if (scopedSocietyId) {
    const scopedSociety = await Society.findById(scopedSocietyId).lean();
    return assertSocietyIsAccessible(scopedSociety);
  }

  const linkedAdminIds = Array.from(
    new Set(
      [
        req?.user?.societyAdminId,
        authUser.linkedSocietyAdminId,
        ...((authUser.linkedSocietyAdminIds || []).map((id) => String(id))),
      ]
        .filter(Boolean)
        .map((id) => String(id))
    )
  );

  if (linkedAdminIds.length > 0) {
    const linkedSocieties = await Society.find({
      'societyAdmins._id': { $in: linkedAdminIds },
    }).lean();
    if (linkedSocieties.length > 0) {
      const accessibleSociety = linkedSocieties.find((society) => isSocietyAccessible(society));
      return assertSocietyIsAccessible(accessibleSociety || linkedSocieties[0]);
    }
  }

  if (authUser.adminSocietyId) {
    const legacySociety = await Society.findById(authUser.adminSocietyId).lean();
    if (legacySociety) {
      return assertSocietyIsAccessible(legacySociety);
    }
  }

  if (allowPhoneFallback) {
    const match = await lookupSocietyAdminByMobile(authUser.phoneNumber || '');
    if (match?.societyId) {
      const phoneSociety = await Society.findById(match.societyId).lean();
      if (phoneSociety) {
        return assertSocietyIsAccessible(phoneSociety);
      }
    }
  }

  throw createHttpError('Society not found.', 404);
};

module.exports = {
  getEffectiveRole,
  isScopedSocietyAdminSession,
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
};
