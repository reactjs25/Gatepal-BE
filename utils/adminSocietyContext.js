const Society = require('../model/societySchema');
const { createHttpError } = require('./httpError');
const { lookupSocietyAdminByMobile } = require('./societyAdminUtils');

const getEffectiveRole = (req, authUser) =>
  req?.user?.effectiveRole || authUser?.role || req?.user?.role || null;

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
    if (!scopedSociety) {
      throw createHttpError('Society not found.', 404);
    }
    return scopedSociety;
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
    const linkedSociety = await Society.findOne({
      'societyAdmins._id': { $in: linkedAdminIds },
    }).lean();
    if (linkedSociety) {
      return linkedSociety;
    }
  }

  if (authUser.adminSocietyId) {
    const legacySociety = await Society.findById(authUser.adminSocietyId).lean();
    if (legacySociety) {
      return legacySociety;
    }
  }

  if (allowPhoneFallback) {
    const match = await lookupSocietyAdminByMobile(authUser.phoneNumber || '');
    if (match?.societyId) {
      const phoneSociety = await Society.findById(match.societyId).lean();
      if (phoneSociety) {
        return phoneSociety;
      }
    }
  }

  throw createHttpError('Society not found.', 404);
};

module.exports = {
  getEffectiveRole,
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
};
