const mongoose = require('mongoose');
const Society = require('../model/societySchema');
const { createHttpError } = require('./httpError');

const toObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  try {
    return new mongoose.Types.ObjectId(value);
  } catch (error) {
    return null;
  }
};

const normalizeAdminEmail = (email = '') => email.trim().toLowerCase();
const normalizeAdminMobile = (mobile = '') => mobile.trim().replace(/\D/g, '');

const buildDigitsOnlyRegex = (digits) => {
  if (!digits) {
    return null;
  }

  const parts = digits.split('').map((d) => `\\D*${d}`);
  const pattern = `^${parts.join('')}\\D*$`;
  return new RegExp(pattern);
};

const lookupSocietyAdminsByMobile = async (mobile, options = {}) => {
  const normalizedMobile = normalizeAdminMobile(mobile);

  if (!normalizedMobile) {
    return null;
  }

  const excludeSocietyObjectId = toObjectId(options.excludeSocietyId);
  const excludeAdminObjectId = toObjectId(options.excludeAdminId);
  const scopeSocietyObjectId = toObjectId(options.scopeSocietyId);

  const mobileRegex = buildDigitsOnlyRegex(normalizedMobile);
  if (!mobileRegex) {
    return null;
  }

  const pipeline = [];

  if (scopeSocietyObjectId) {
    pipeline.push({ $match: { _id: scopeSocietyObjectId } });
  }

  if (excludeSocietyObjectId) {
    pipeline.push({ $match: { _id: { $ne: excludeSocietyObjectId } } });
  }

  pipeline.push(
    { $project: { societyId: '$_id', societyName: '$societyName', societyAdmins: 1 } },
    { $unwind: '$societyAdmins' },
    {
      $match: {
        'societyAdmins.mobile': { $regex: mobileRegex },
        ...(excludeAdminObjectId ? { 'societyAdmins._id': { $ne: excludeAdminObjectId } } : {}),
      },
    },
    { $project: { societyId: 1, societyName: 1, adminId: '$societyAdmins._id' } }
  );

  const results = await Society.aggregate(pipeline);
  return results.map((match) => ({
    societyId: match.societyId,
    societyName: match.societyName,
    adminId: match.adminId,
    normalizedMobile,
  }));
};

const lookupSocietyAdminByMobile = async (mobile, options = {}) => {
  const matches = await lookupSocietyAdminsByMobile(mobile, options);
  return matches[0] || null;
};

const findSocietyAdminByPhone = async (phoneNumber) => {
  const match = await lookupSocietyAdminByMobile(phoneNumber);

  if (!match) {
    return null;
  }

  const society = await Society.findById(match.societyId);

  if (!society) {
    return null;
  }

  const admin = society.societyAdmins.id(match.adminId);

  if (!admin) {
    return null;
  }

  return { society, admin };
};

const findSocietyAdminsByPhone = async (phoneNumber) => {
  const matches = await lookupSocietyAdminsByMobile(phoneNumber);
  if (!matches.length) {
    return [];
  }

  const societyIds = matches.map((m) => m.societyId);
  const societies = await Society.find({ _id: { $in: societyIds } });
  const societyMap = new Map(societies.map((s) => [String(s._id), s]));

  return matches
    .map((match) => {
      const society = societyMap.get(String(match.societyId));
      if (!society) return null;
      const admin = society.societyAdmins.id(match.adminId);
      if (!admin) return null;
      return { society, admin };
    })
    .filter(Boolean);
};

const findSocietyAdminByEmail = async (email, options = {}) => {
  const normalizedEmail = normalizeAdminEmail(email || '');

  if (!normalizedEmail) {
    return null;
  }

  const query = {
    'societyAdmins.email': normalizedEmail,
  };

  const societyObjectId = toObjectId(options.excludeSocietyId);
  const scopeSocietyObjectId = toObjectId(options.scopeSocietyId);
  if (scopeSocietyObjectId) {
    query._id = scopeSocietyObjectId;
  }

  if (societyObjectId) {
    query._id = { $ne: societyObjectId };
  }

  const society = await Society.findOne(query, { societyName: 1, societyAdmins: 1 }).lean();

  if (!society) {
    return null;
  }

  const admin = (society.societyAdmins || []).find((candidate) => {
    if (!candidate.email) {
      return false;
    }

    const matchesEmail = candidate.email.toLowerCase() === normalizedEmail;
    if (!matchesEmail) {
      return false;
    }

    if (!options.excludeAdminId) {
      return true;
    }

    return candidate._id.toString() !== options.excludeAdminId.toString();
  });

  if (!admin) {
    return null;
  }

  return {
    societyId: society._id,
    societyName: society.societyName,
    adminId: admin._id,
  };
};

const ensureAdminContactsUnique = async (
  { email, rawEmail, mobile, rawMobile },
  options = {}
) => {
  const scopeSocietyObjectId = toObjectId(options.scopeSocietyId);

  if (email) {
    const conflict = await findSocietyAdminByEmail(email, options);
    if (conflict) {
      throw createHttpError(
        scopeSocietyObjectId
          ? `An admin with email ${rawEmail || email} already exists in this society`
          : `An admin with email ${rawEmail || email} already exists in ${conflict.societyName}`,
        409
      );
    }
  }

  if (mobile) {
    if (mobile.length < 10 || mobile.length > 12) {
      throw createHttpError('Admin mobile must contain between 10 and 12 digits.', 400);
    }
    const conflict = await lookupSocietyAdminByMobile(mobile, options);
    if (conflict) {
      throw createHttpError(
        scopeSocietyObjectId
          ? `An admin with mobile number ${rawMobile || mobile} already exists in this society`
          : `An admin with mobile number ${rawMobile || mobile} already exists in ${conflict.societyName}`,
        409
      );
    }
  }
};

const ensureAdminListIsUnique = async (admins = [], options = {}) => {
  if (!Array.isArray(admins) || admins.length === 0) {
    return;
  }

  const seenEmails = new Set();
  const seenMobiles = new Set();

  for (const admin of admins) {
    const normalizedEmail = admin.email ? normalizeAdminEmail(admin.email) : null;
    const normalizedMobile = admin.mobile ? normalizeAdminMobile(admin.mobile) : null;

    if (normalizedEmail) {
      if (seenEmails.has(normalizedEmail)) {
        throw createHttpError(`Duplicate admin email ${admin.email} in payload`, 400);
      }
      seenEmails.add(normalizedEmail);
    }

    if (normalizedMobile) {
      if (seenMobiles.has(normalizedMobile)) {
        throw createHttpError(`Duplicate admin mobile ${admin.mobile} in payload`, 400);
      }
      seenMobiles.add(normalizedMobile);
    }

    if (!options.skipDbCheck) {
      await ensureAdminContactsUnique(
        {
          email: normalizedEmail,
          rawEmail: admin.email,
          mobile: normalizedMobile,
          rawMobile: admin.mobile,
        },
        options
      );
    }
  }
};

module.exports = {
  normalizeAdminEmail,
  normalizeAdminMobile,
  findSocietyAdminByPhone,
  findSocietyAdminsByPhone,
  ensureAdminContactsUnique,
  ensureAdminListIsUnique,
  lookupSocietyAdminsByMobile,
  lookupSocietyAdminByMobile,
};


