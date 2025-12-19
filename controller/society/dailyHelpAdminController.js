const mongoose = require('mongoose');
const DailyHelp = require('../../model/dailyHelpSchema');
const DailyHelpAssignment = require('../../model/dailyHelpAssignmentSchema');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const User = require('../../model/userSchema');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { normalizeDigits, normalizeCountryCode } = require('../../utils/phoneNumber');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
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

const formatStatusForClient = (value) => {
  const v = normalizeString(value);
  if (!v) return v;
  const upper = v.toUpperCase();
  if (upper === 'PENDING') return 'Pending';
  if (upper === 'APPROVED') return 'Verified';
  if (upper === 'REJECTED') return 'Rejected';
  if (upper === 'REMOVED') return 'Removed';
  return v;
};

const DAILY_HELP_CATEGORIES = [
  { id: 'car_cleaner', name: 'Car Cleaner' },
  { id: 'cook', name: 'Cook' },
  { id: 'driver', name: 'Driver' },
  { id: 'gardener', name: 'Gardener' },
  { id: 'laundry', name: 'Laundry' },
  { id: 'maid', name: 'Maid' },
  { id: 'milkman', name: 'Milkman' },
  { id: 'nanny_baby_sitter', name: 'Nanny/Baby Sitter' },
  { id: 'others', name: 'Others' },
];

const ALLOWED_WORK_CATEGORY_IDS = new Set(DAILY_HELP_CATEGORIES.map((c) => c.id));

const DAILY_HELP_REJECT_REASON_CATEGORIES = [
  'Incomplete details',
  'Incorrect details',
  'Missing ID proof',
  'Photo mismatch',
  'Background verification pending',
  'Police verification not done',
  'Helper not authorized for that unit',
  'Owner approval not received',
  'Helper previously blacklisted',
  'Complaints against the helper',
  'Identity mismatch',
  'Unregistered agency',
  'Agency not approved',
  'Security concerns',
  'Suspicious behaviour',
  'Not meeting society onboarding rules',
  'Missing vaccination certificate',
  'Helper previously terminated',
  'Attempt to bypass entry process',
  'Incorrect phone number',
  'Wrong apartment details',
  'Others',
];

const DAILY_HELP_REJECT_REASON_CODES = new Set(
  DAILY_HELP_REJECT_REASON_CATEGORIES.map((name) => name.toLowerCase().replace(/\s+/g, '_'))
);

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

    const query = { societyId: society._id };
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

    const records = items.map((d) => ({
      id: String(d._id),
      societyId: String(d.societyId),
      name: d.name,
      category: d.category,
      countryCode: d.countryCode || '+91',
      phoneNumber: d.phoneNumber || null,
      imageUrl: d.imageUrl || null,
      status: formatStatusForClient(d.status),
      createdByRole: d.createdByRole,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      requests: assignmentsByHelp[String(d._id)] || [],
    }));

    return sendSuccessResponse(res, 200, 'Society daily help fetched successfully', {
      data: records.length > 0 ? records : null,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society daily help'));
  }
};


const addSocietyDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const { category, name, countryCode, phoneNumber, imageUrl, complianceConfirmed } = req.body || {};
    const nm = normalizeString(name);
    if (!nm) return next(createHttpError('name is required', 400));

    const canonicalCategory = normalizeString(category).toLowerCase().replace(/\s+/g, '_');
    if (!canonicalCategory || !ALLOWED_WORK_CATEGORY_IDS.has(canonicalCategory)) {
      return next(createHttpError('Invalid category', 400));
    }

    if (!complianceConfirmed) {
      return next(createHttpError('Compliance confirmation is required', 400));
    }

    const normalizedCode = normalizeCountryCode(countryCode || '+91');
    const digits = normalizeDigits(phoneNumber || '');
    if (!digits || digits.length !== 10) {
      return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
    }

    const formattedImage = imageUrl !== undefined
      ? ensureBase64ImageDataUrl({ value: imageUrl, fieldLabel: 'Image' })
      : null;

    const comparable = `${normalizedCode.replace(/\D/g, '')}${digits}`;

    const existsUser = await User.exists({ phoneNumber: digits });
    if (existsUser) return next(createHttpError('This phone number already exists in the system', 409));

    const FamilyMember = require('../../model/familyMemberSchema');
    const fmExists = await FamilyMember.exists({ phoneDigits: digits });
    if (fmExists) return next(createHttpError('This phone number already exists in the system', 409));

    const SuperAdmin = require('../../model/superAdminSchema');
    const saExists = await SuperAdmin.exists({ phoneNumber: digits });
    if (saExists) return next(createHttpError('This phone number already exists in the system', 409));

    const adminExists = await lookupSocietyAdminByMobile(digits);
    if (adminExists) return next(createHttpError('This phone number already exists in the system', 409));

    let person = await DailyHelp.findOne({ societyId: society._id, category: canonicalCategory, phoneDigits: digits });

    if (!person) {
      person = await DailyHelp.create({
        societyId: society._id,
        category: canonicalCategory,
        name: nm,
        countryCode: normalizedCode,
        phoneNumber: phoneNumber,
        phoneDigits: digits,
        comparablePhone: comparable,
        imageUrl: formattedImage,
        status: 'APPROVED',
        approvedAt: new Date(),
        rejectedAt: null,
        rejectReasonCode: null,
        rejectReasonText: null,
        createdByUserId: authUser._id,
        createdByRole: 'society_admin',
      });
    } else if (person.status !== 'APPROVED') {
      person.status = 'APPROVED';
      person.approvedAt = new Date();
      person.rejectedAt = null;
      person.rejectReasonCode = null;
      person.rejectReasonText = null;
      await person.save();
      await DailyHelpAssignment.updateMany(
        { dailyHelpId: person._id, status: 'PENDING' },
        { $set: { status: 'APPROVED' } }
      );
    }

    return sendSuccessResponse(res, 201, 'Society daily help added successfully', {
      data: {
        id: String(person._id),
        societyId: String(person.societyId),
        name: person.name,
        category: person.category,
        countryCode: person.countryCode || '+91',
        phoneNumber: person.phoneNumber || null,
        imageUrl: person.imageUrl || null,
        status: person.status === 'APPROVED' ? 'Verified' : formatStatusForClient(person.status),
        createdAt: person.createdAt,
        updatedAt: person.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add daily help'));
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
        status: doc.status === 'APPROVED' ? 'Verified' : formatStatusForClient(doc.status),
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
        status: doc.status === 'APPROVED' ? 'Verified' : doc.status,
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

    const { rejectReason, description, reasonCode, reasonText, unitId, unitNumber, name, category, phoneNumber, imageUrl } = req.body || {};
    const rc = normalizeString(rejectReason !== undefined ? rejectReason : reasonCode);
    if (!rc) return next(createHttpError('Reject reason is mandatory', 400));
    const rcLower = rc.toLowerCase();
    const reasonCodeCanonical = rcLower.replace(/\s+/g, '_');
    if (!DAILY_HELP_REJECT_REASON_CODES.has(reasonCodeCanonical)) {
      return next(createHttpError('Invalid reject reason', 400));
    }
    const desc = normalizeString(description !== undefined ? description : reasonText);
    if (reasonCodeCanonical === 'others' && !desc) {
      return next(createHttpError('Reject reason description is mandatory when reason is others', 400));
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
    doc.rejectReasonCode = reasonCodeCanonical;
    doc.rejectReasonText = desc || null;
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
        status: formatStatusForClient(doc.status),
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
        data: { id: String(doc._id), status: formatStatusForClient(doc.status), removedAt: doc.removedAt, updatedAt: doc.updatedAt },
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
        status: formatStatusForClient(doc.status),
        removedAt: doc.removedAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove daily help from society'));
  }
};

const getDailyHelpCategories = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    await resolveAdminSociety(authUser);

    const categories = DAILY_HELP_CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
    }));

    return sendSuccessResponse(res, 200, 'Daily help categories fetched successfully', {
      data: categories,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help categories'));
  }
};

const getDailyHelpRejectReasonCategories = async (req, res, next) => {
  try {
    const categories = DAILY_HELP_REJECT_REASON_CATEGORIES.map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
    }));

    return sendSuccessResponse(res, 200, 'Daily help reject reason categories fetched successfully', {
      data: categories,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help reject reason categories'));
  }
};

const editSocietyDailyHelpProfile = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const dailyHelpId = normalizeString((req.params && (req.params.dailyHelpId || req.params.id)) || (req.body || {}).dailyHelpId);
    if (!dailyHelpId || !mongoose.Types.ObjectId.isValid(dailyHelpId)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    const payload = req.body || {};
    const { category, name, phoneNumber, imageUrl, countryCode } = payload;
    if (category !== undefined && typeof category !== 'string') {
      return next(createHttpError('category must be a string', 400));
    }
    if (name !== undefined && typeof name !== 'string') {
      return next(createHttpError('name must be a string', 400));
    }
    if (phoneNumber !== undefined && typeof phoneNumber !== 'string') {
      return next(createHttpError('phoneNumber must be a string', 400));
    }
    if (imageUrl !== undefined && typeof imageUrl !== 'string') {
      return next(createHttpError('imageUrl must be a string', 400));
    }

    const doc = await DailyHelp.findById(dailyHelpId);
    if (!doc) return next(createHttpError('Daily help not found', 404));

    await assertAdminAccessForDailyHelp({ authUser, dailyHelp: doc });

    const updates = {};

    if (category !== undefined) {
      const canonicalCategory = normalizeString(category).toLowerCase().replace(/\s+/g, '_');
      if (!canonicalCategory || !ALLOWED_WORK_CATEGORY_IDS.has(canonicalCategory)) {
        return next(createHttpError('Invalid category', 400));
      }
      updates.category = canonicalCategory;
    }

    if (name !== undefined) {
      const nm = normalizeString(name);
      if (!nm) return next(createHttpError('name cannot be empty', 400));
      if (nm.length < 2 || nm.length > 50) {
        return next(createHttpError('name must be between 2 and 50 characters', 400));
      }
      updates.name = nm;
    }

    if (imageUrl !== undefined) {
      const formatted = ensureBase64ImageDataUrl({ value: imageUrl, fieldLabel: 'Image' });
      updates.imageUrl = formatted;
    }

    if (phoneNumber !== undefined) {
      const digits = normalizeDigits(phoneNumber || '');
      if (digits && digits.length !== 10) {
        return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
      }

      const normalizedCode = normalizeCountryCode(countryCode || doc.countryCode || '+91');
      const comparable = digits ? `${normalizedCode.replace(/\D/g, '')}${digits}` : null;

      if (digits) {
        const existsUser = await User.exists({ phoneNumber: digits });
        if (existsUser) return next(createHttpError('This phone number already exists in the system', 409));

        const FamilyMember = require('../../model/familyMemberSchema');
        const fmExists = await FamilyMember.exists({ phoneDigits: digits });
        if (fmExists) return next(createHttpError('This phone number already exists in the system', 409));

        const SuperAdmin = require('../../model/superAdminSchema');
        const saExists = await SuperAdmin.exists({ phoneNumber: digits });
        if (saExists) return next(createHttpError('This phone number already exists in the system', 409));

        const adminExists = await lookupSocietyAdminByMobile(digits);
        if (adminExists) return next(createHttpError('This phone number already exists in the system', 409));

        const nextCategory = updates.category !== undefined ? updates.category : doc.category;
        const dup = await DailyHelp.exists({ societyId: doc.societyId, category: nextCategory, phoneDigits: digits, _id: { $ne: doc._id } });
        if (dup) return next(createHttpError('A daily help with this category and phone number already exists', 409));

        updates.countryCode = normalizedCode;
        updates.phoneNumber = phoneNumber;
        updates.phoneDigits = digits;
        updates.comparablePhone = comparable;
      } else {
        updates.phoneNumber = null;
        updates.phoneDigits = null;
        updates.comparablePhone = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return sendSuccessResponse(res, 200, 'No changes provided', {
        data: {
          id: String(doc._id),
          societyId: String(doc.societyId),
          name: doc.name,
          category: doc.category,
          countryCode: doc.countryCode || '+91',
          phoneNumber: doc.phoneNumber || null,
          imageUrl: doc.imageUrl || null,
          status: doc.status,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        },
      });
    }

    Object.assign(doc, updates);
    await doc.save();

    return sendSuccessResponse(res, 200, 'Daily help profile updated successfully', {
      data: {
        id: String(doc._id),
        societyId: String(doc.societyId),
        name: doc.name,
        category: doc.category,
        countryCode: doc.countryCode || '+91',
        phoneNumber: doc.phoneNumber || null,
        imageUrl: doc.imageUrl || null,
        status: formatStatusForClient(doc.status),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update daily help profile'));
  }
};

module.exports = {
  approveDailyHelp,
  rejectDailyHelp,
  removeDailyHelpFromSociety,
  listSocietyDailyHelp,
  getSocietyDailyHelpProfileById,
  addSocietyDailyHelp,
  editSocietyDailyHelpProfile,
  getDailyHelpCategories,
  getDailyHelpRejectReasonCategories,
};
