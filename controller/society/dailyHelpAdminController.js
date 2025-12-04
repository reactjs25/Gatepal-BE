const mongoose = require('mongoose');
const DailyHelp = require('../../model/dailyHelpSchema');
const DailyHelpAssignment = require('../../model/dailyHelpAssignmentSchema');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const User = require('../../model/userSchema');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { normalizeDigits } = require('../../utils/phoneNumber');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
 

const assertAdminAccessForDailyHelp = async ({ authUser, dailyHelp }) => {
  if (!authUser) throw createHttpError('Unauthorized', 401);
  const effectiveRole = (authUser.role === 'society_admin' || (authUser.linkedSocietyAdminId ? 'society_admin' : ''));
  const isAdmin = effectiveRole === 'society_admin' || !!authUser.linkedSocietyAdminId;
  if (!isAdmin) throw createHttpError('Only society admins can perform this action', 403);

  const society = await Society.findById(dailyHelp.societyId).lean();
  if (!society) throw createHttpError('Society not found', 404);

  const digits = normalizeDigits(authUser.phoneNumber || '');
  const linkedId = authUser.linkedSocietyAdminId || null;
  const hasPrivilege = (society.societyAdmins || []).some((a) => {
    if (linkedId) return String(a._id) === String(linkedId);
    return normalizeDigits(a.mobile || '') === digits;
  });
  if (!hasPrivilege) throw createHttpError('Forbidden: admin does not belong to this society', 403);
  return society;
};

const resolveAdminSociety = async (authUser) => {
  if (!authUser) throw createHttpError('Unauthorized', 401);
  if (authUser.adminSocietyId) {
    const society = await Society.findById(authUser.adminSocietyId).lean();
    if (!society) throw createHttpError('Society not found', 404);
    return society;
  }
  const linkedId = authUser.linkedSocietyAdminId || null;
  if (linkedId) {
    const society = await Society.findOne({ 'societyAdmins._id': linkedId }).lean();
    if (!society) throw createHttpError('Society not found', 404);
    return society;
  }
  const match = await lookupSocietyAdminByMobile(authUser.phoneNumber || '');
  if (!match) throw createHttpError('Society not found', 404);
  const society = await Society.findById(match.societyId).lean();
  if (!society) throw createHttpError('Society not found', 404);
  return society;
};

const mapUiStatusToCanonical = (value) => {
  let v = normalizeString(value).toLowerCase();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!v) return '';
  if (v === 'pending') return 'PENDING';
  if (v === 'approved') return 'APPROVED';
  if (v === 'rejected') return 'REJECTED';
  if (v === 'removed') return 'REMOVED';
  return '';
};

const listSocietyDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const statusCanonical = mapUiStatusToCanonical((req.query || {}).status || 'pending');
    const category = normalizeString((req.query || {}).category);
    const residentIds = await MemberUnit.distinct('memberId', {
      societyId: society._id,
      occupancyStatus: 'currently_residing',
    });

    const query = { societyId: society._id, createdByRole: 'member', createdByUserId: { $in: residentIds } };
    if (statusCanonical) query.status = statusCanonical;
    if (category) query.category = category.toLowerCase().replace(/\s+/g, '_');

    const items = await DailyHelp.find(query).sort({ createdAt: -1 }).lean();

    const helpIds = items.map((d) => d._id);
    const assignmentQuery = { dailyHelpId: { $in: helpIds } };
    if (statusCanonical) assignmentQuery.status = statusCanonical;
    const assignments = await DailyHelpAssignment.find(assignmentQuery).lean();

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    const memberIds = Array.from(new Set(assignments.map((a) => String(a.memberId))));
    const users = await User.find({ _id: { $in: memberIds } }, { fullName: 1, phoneNumber: 1 }).lean();
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const unitLookups = assignments.map((a) => {
      const parsed = parseUnit(a.unitId);
      return {
        key: `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`,
        societyId: parsed.societyId,
        wingLower: parsed.wingLower,
        unitLower: parsed.unitLower,
        memberId: a.memberId,
      };
    });

    const uniqueUnitKeys = Array.from(new Set(unitLookups.map((x) => x.key)));
    const unitQueryOr = uniqueUnitKeys.map((key) => {
      const [memberId, wingLower, unitLower] = key.split(':');
      return { memberId, wingNameLower: wingLower, unitNumberLower: unitLower };
    });

    let units = [];
    if (unitQueryOr.length > 0) {
      units = await MemberUnit.find({ $or: unitQueryOr }, { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, memberId: 1 }).lean();
    }
    const unitMap = units.reduce((acc, u) => {
      acc[`${String(u.memberId)}:${u.wingNameLower}:${u.unitNumberLower}`] = u;
      return acc;
    }, {});

    const assignmentsByHelp = assignments.reduce((acc, a) => {
      const parsed = parseUnit(a.unitId);
      const key = `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`;
      const unitDoc = unitMap[key];
      const userDoc = userMap[String(a.memberId)] || {};
      const record = {
        memberId: String(a.memberId),
        memberName: userDoc.fullName || null,
        memberPhone: userDoc.phoneNumber || null,
        wingName: unitDoc ? unitDoc.wingName : null,
        unitNumber: unitDoc ? unitDoc.unitNumber : null,
        unitId: unitDoc ? String(unitDoc._id) : null,
      };
      const hId = String(a.dailyHelpId);
      if (!acc[hId]) acc[hId] = [];
      acc[hId].push(record);
      return acc;
    }, {});

    return sendSuccessResponse(res, 200, 'Society daily help fetched successfully', {
      data: items.map((d) => ({
        id: String(d._id),
        societyId: String(d.societyId),
        name: d.name,
        category: d.category,
        countryCode: d.countryCode || '+91',
        phoneNumber: d.phoneNumber || null,
        imageUrl: d.imageUrl || null,
        status: d.status,
        createdByRole: d.createdByRole,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        requests: assignmentsByHelp[String(d._id)] || [],
      })),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society daily help'));
  }
};


const getSocietyDailyHelpProfileById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const dailyHelpId = normalizeString(req.params.dailyHelpId || req.params.id);
    if (!dailyHelpId || !mongoose.Types.ObjectId.isValid(dailyHelpId)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    const statusCanonical = mapUiStatusToCanonical((req.query || {}).status || '');

    const doc = await DailyHelp.findById(dailyHelpId).lean();
    if (!doc) return next(createHttpError('Daily help not found', 404));

    await assertAdminAccessForDailyHelp({ authUser, dailyHelp: doc });

    const assignmentQuery = { dailyHelpId: doc._id };
    if (statusCanonical) assignmentQuery.status = statusCanonical;
    const assignments = await DailyHelpAssignment.find(assignmentQuery).lean();

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    const memberIds = Array.from(new Set(assignments.map((a) => String(a.memberId))));
    const users = await User.find({ _id: { $in: memberIds } }, { fullName: 1, phoneNumber: 1 }).lean();
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const unitLookups = assignments.map((a) => {
      const parsed = parseUnit(a.unitId);
      return {
        key: `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`,
        wingLower: parsed.wingLower,
        unitLower: parsed.unitLower,
        memberId: a.memberId,
      };
    });

    const uniqueUnitKeys = Array.from(new Set(unitLookups.map((x) => x.key)));
    const unitQueryOr = uniqueUnitKeys.map((key) => {
      const [memberId, wingLower, unitLower] = key.split(':');
      return { memberId, wingNameLower: wingLower, unitNumberLower: unitLower };
    });

    let units = [];
    if (unitQueryOr.length > 0) {
      units = await MemberUnit.find({ $or: unitQueryOr }, { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, memberId: 1 }).lean();
    }
    const unitMap = units.reduce((acc, u) => {
      acc[`${String(u.memberId)}:${u.wingNameLower}:${u.unitNumberLower}`] = u;
      return acc;
    }, {});

    const requests = assignments.map((a) => {
      const parsed = parseUnit(a.unitId);
      const key = `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`;
      const unitDoc = unitMap[key];
      const userDoc = userMap[String(a.memberId)] || {};
      return {
        memberId: String(a.memberId),
        memberName: userDoc.fullName || null,
        memberPhone: userDoc.phoneNumber || null,
        wingName: unitDoc ? unitDoc.wingName : null,
        unitNumber: unitDoc ? unitDoc.unitNumber : null,
        unitId: unitDoc ? String(unitDoc._id) : null,
      };
    });

    return sendSuccessResponse(res, 200, 'Daily help profile fetched successfully', {
      data: {
        id: String(doc._id),
        societyId: String(doc.societyId),
        name: doc.name,
        category: doc.category,
        countryCode: doc.countryCode || '+91',
        phoneNumber: doc.phoneNumber || null,
        imageUrl: doc.imageUrl || null,
        status: doc.status,
        createdByRole: doc.createdByRole,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        requests,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help profile'));
  }
};

const approveDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const dailyHelpId = normalizeString(req.params.dailyHelpId || req.params.id);
    if (!dailyHelpId || !mongoose.Types.ObjectId.isValid(dailyHelpId)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    const {
      complianceConfirmed,
      unitId,
      unitNumber,
      name,
      category,
      phoneNumber,
      imageUrl,
    } = req.body || {};
    if (!complianceConfirmed) {
      return next(createHttpError('Compliance confirmation is required', 400));
    }

    const doc = await DailyHelp.findById(dailyHelpId);
    if (!doc) return next(createHttpError('Daily help not found', 404));

    await assertAdminAccessForDailyHelp({ authUser, dailyHelp: doc });

    if (name !== undefined) {
      const nm = normalizeString(name);
      if (!nm) return next(createHttpError('name cannot be empty', 400));
      if (nm.toLowerCase() !== normalizeString(doc.name).toLowerCase()) {
        return next(createHttpError('Payload name does not match record', 409));
      }
    }

    if (category !== undefined) {
      const canonicalCategory = normalizeString(category).toLowerCase().replace(/\s+/g, '_');
      if (canonicalCategory !== doc.category) {
        return next(createHttpError('Payload category does not match record', 409));
      }
    }

    if (phoneNumber !== undefined) {
      const digits = normalizeDigits(phoneNumber || '');
      const docDigits = normalizeDigits(doc.phoneDigits || doc.phoneNumber || '');
      if (digits && docDigits && digits !== docDigits) {
        return next(createHttpError('Payload phoneNumber does not match record', 409));
      }
    }

    if (imageUrl !== undefined) {
      const img = normalizeString(imageUrl);
      const docImg = normalizeString(doc.imageUrl || '');
      if (img && docImg && img !== docImg) {
        return next(createHttpError('Payload imageUrl does not match record', 409));
      }
    }

    if (unitId || unitNumber) {
      if (!mongoose.Types.ObjectId.isValid(unitId)) {
        if (!unitNumber) {
          return next(createHttpError('Invalid unitId', 400));
        }
      }
      let unitDoc = null;
      if (unitId && mongoose.Types.ObjectId.isValid(unitId)) {
        unitDoc = await MemberUnit.findById(unitId).lean();
      } else {
        const unitLower = normalizeString(unitNumber).toLowerCase();
        const matches = await MemberUnit.find({
          societyId: doc.societyId,
          unitNumberLower: unitLower,
        }).lean();
        if (!matches || matches.length === 0) {
          return next(createHttpError('Unit not found', 404));
        }
        if (matches.length > 1) {
          return next(createHttpError('Ambiguous unit number, provide unitId', 400));
        }
        unitDoc = matches[0];
      }
      if (!unitDoc) return next(createHttpError('Unit not found', 404));
      if (String(unitDoc.societyId) !== String(doc.societyId)) {
        return next(createHttpError('Unit does not belong to this society', 403));
      }
      const canonicalUnitId = `${String(unitDoc.societyId)}:${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`;
      const pendingAssignment = await DailyHelpAssignment.findOne({ dailyHelpId: doc._id, unitId: canonicalUnitId });
      if (!pendingAssignment || pendingAssignment.status === 'REMOVED') {
        return next(createHttpError('No active assignment found for provided unit', 404));
      }
    }

    doc.status = 'APPROVED';
    doc.approvedAt = new Date();
    doc.rejectedAt = null;
    doc.rejectReasonCode = null;
    doc.rejectReasonText = null;
    await doc.save();

    await DailyHelpAssignment.updateMany(
      { dailyHelpId: doc._id, status: 'PENDING' },
      { $set: { status: 'APPROVED' } }
    );

    return sendSuccessResponse(res, 200, 'Daily help approved successfully', {
      data: {
        id: String(doc._id),
        societyId: String(doc.societyId),
        name: doc.name,
        category: doc.category,
        countryCode: doc.countryCode || '+91',
        phoneNumber: doc.phoneNumber || null,
        imageUrl: doc.imageUrl || null,
        status: doc.status,
        approvedAt: doc.approvedAt,
        updatedAt: doc.updatedAt,
        complianceConfirmed: true,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to approve daily help'));
  }
};

const rejectDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const dailyHelpId = normalizeString(req.params.dailyHelpId || req.params.id);
    if (!dailyHelpId || !mongoose.Types.ObjectId.isValid(dailyHelpId)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    const { reasonCode, reasonText, unitId, unitNumber, name, category, phoneNumber, imageUrl } = req.body || {};
    const rc = normalizeString(reasonCode);
    if (!rc) return next(createHttpError('Reject reason is mandatory', 400));
    if (rc.toLowerCase() === 'other' && !normalizeString(reasonText)) {
      return next(createHttpError('Reject reason text is mandatory for Other', 400));
    }

    const doc = await DailyHelp.findById(dailyHelpId);
    if (!doc) return next(createHttpError('Daily help not found', 404));

    await assertAdminAccessForDailyHelp({ authUser, dailyHelp: doc });

    if (name !== undefined) {
      const nm = normalizeString(name);
      if (!nm) return next(createHttpError('name cannot be empty', 400));
      if (nm.toLowerCase() !== normalizeString(doc.name).toLowerCase()) {
        return next(createHttpError('Payload name does not match record', 409));
      }
    }

    if (category !== undefined) {
      const canonicalCategory = normalizeString(category).toLowerCase().replace(/\s+/g, '_');
      if (canonicalCategory !== doc.category) {
        return next(createHttpError('Payload category does not match record', 409));
      }
    }

    if (phoneNumber !== undefined) {
      const digits = normalizeDigits(phoneNumber || '');
      const docDigits = normalizeDigits(doc.phoneDigits || doc.phoneNumber || '');
      if (digits && docDigits && digits !== docDigits) {
        return next(createHttpError('Payload phoneNumber does not match record', 409));
      }
    }

    if (imageUrl !== undefined) {
      const img = normalizeString(imageUrl);
      const docImg = normalizeString(doc.imageUrl || '');
      if (img && docImg && img !== docImg) {
        return next(createHttpError('Payload imageUrl does not match record', 409));
      }
    }

    if (unitId || unitNumber) {
      if (!mongoose.Types.ObjectId.isValid(unitId)) {
        if (!unitNumber) {
          return next(createHttpError('Invalid unitId', 400));
        }
      }
      let unitDoc = null;
      if (unitId && mongoose.Types.ObjectId.isValid(unitId)) {
        unitDoc = await MemberUnit.findById(unitId).lean();
      } else {
        const unitLower = normalizeString(unitNumber).toLowerCase();
        const matches = await MemberUnit.find({
          societyId: doc.societyId,
          unitNumberLower: unitLower,
        }).lean();
        if (!matches || matches.length === 0) {
          return next(createHttpError('Unit not found', 404));
        }
        if (matches.length > 1) {
          return next(createHttpError('Ambiguous unit number, provide unitId', 400));
        }
        unitDoc = matches[0];
      }
      if (!unitDoc) return next(createHttpError('Unit not found', 404));
      if (String(unitDoc.societyId) !== String(doc.societyId)) {
        return next(createHttpError('Unit does not belong to this society', 403));
      }
      const canonicalUnitId = `${String(unitDoc.societyId)}:${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`;
      const assignment = await DailyHelpAssignment.findOne({ dailyHelpId: doc._id, unitId: canonicalUnitId });
      if (!assignment || assignment.status === 'REMOVED') {
        return next(createHttpError('No active assignment found for provided unit', 404));
      }
    }

    doc.status = 'REJECTED';
    doc.rejectedAt = new Date();
    doc.rejectReasonCode = rc;
    doc.rejectReasonText = normalizeString(reasonText) || null;
    doc.approvedAt = null;
    await doc.save();

    await DailyHelpAssignment.updateMany(
      { dailyHelpId: doc._id, status: 'PENDING' },
      { $set: { status: 'REJECTED' } }
    );

    return sendSuccessResponse(res, 200, 'Daily help rejected successfully', {
      data: {
        id: String(doc._id),
        societyId: String(doc.societyId),
        name: doc.name,
        category: doc.category,
        countryCode: doc.countryCode || '+91',
        phoneNumber: doc.phoneNumber || null,
        imageUrl: doc.imageUrl || null,
        status: doc.status,
        rejectedAt: doc.rejectedAt,
        rejectReasonCode: doc.rejectReasonCode,
        rejectReasonText: doc.rejectReasonText,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to reject daily help'));
  }
};

const removeDailyHelpFromSociety = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const dailyHelpId = normalizeString(req.params.dailyHelpId || req.params.id);
    if (!dailyHelpId || !mongoose.Types.ObjectId.isValid(dailyHelpId)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    const doc = await DailyHelp.findById(dailyHelpId);
    if (!doc) return next(createHttpError('Daily help not found', 404));

    await assertAdminAccessForDailyHelp({ authUser, dailyHelp: doc });

    if (doc.status === 'REMOVED') {
      return sendSuccessResponse(res, 200, 'Daily help already removed from society', {
        data: { id: String(doc._id), status: doc.status, removedAt: doc.removedAt, updatedAt: doc.updatedAt },
      });
    }

    doc.status = 'REMOVED';
    doc.removedAt = new Date();
    await doc.save();

    await DailyHelpAssignment.updateMany(
      { dailyHelpId: doc._id, status: { $ne: 'REMOVED' } },
      { $set: { status: 'REMOVED' } }
    );

    return sendSuccessResponse(res, 200, 'Daily help removed from society successfully', {
      data: {
        id: String(doc._id),
        societyId: String(doc.societyId),
        status: doc.status,
        removedAt: doc.removedAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove daily help from society'));
  }
};

module.exports = {
  approveDailyHelp,
  rejectDailyHelp,
  removeDailyHelpFromSociety,
  listSocietyDailyHelp,
  getSocietyDailyHelpProfileById,
};
