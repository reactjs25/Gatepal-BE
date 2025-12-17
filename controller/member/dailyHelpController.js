const DailyHelp = require('../../model/dailyHelpSchema');
const DailyHelpAssignment = require('../../model/dailyHelpAssignmentSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const FamilyMember = require('../../model/familyMemberSchema');
const mongoose = require('mongoose');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { normalizeDigits, normalizeCountryCode } = require('../../utils/phoneNumber');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { assertUnitAccess, buildCanonicalUnitId } = require('../../utils/unitAccess');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

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

const toCanonicalCategory = (value) => (value || '').toString().trim().toLowerCase().replace(/\s+/g, '_');

const getDailyHelpCategories = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'admin') return next(createHttpError('Only members can view daily help', 403));

    return sendSuccessResponse(res, 200, 'Daily help categories fetched successfully', {
      data: DAILY_HELP_CATEGORIES,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help categories'));
  }
};

const addDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can add daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId);
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const { category, name, countryCode, phoneNumber, imageUrl, complianceConfirmed } = req.body || {};
    const nm = normalizeString(name);
    if (!nm) return next(createHttpError('name is required', 400));

    const canonicalCategory = toCanonicalCategory(category);
    if (!canonicalCategory || !ALLOWED_WORK_CATEGORY_IDS.has(canonicalCategory)) {
      return next(createHttpError('Invalid category', 400));
    }

    const normalizedCode = normalizeCountryCode(countryCode || '+91');
    const digits = normalizeDigits(phoneNumber || '');
    if (!digits || digits.length !== 10) {
      return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
    }

    const formattedImage = imageUrl !== undefined ? ensureBase64ImageDataUrl({ value: imageUrl, fieldLabel: 'Image' }) : null;

    if (!complianceConfirmed) {
      return next(createHttpError('Compliance confirmation is required', 400));
    }

    const comparable = `${normalizedCode.replace(/\D/g, '')}${digits}`;

    const existsUser = await User.exists({ phoneNumber: digits });
    if (existsUser) return next(createHttpError('This phone number already exists in the system', 409));

    const fmExists = await FamilyMember.exists({ phoneDigits: digits });
    if (fmExists) return next(createHttpError('This phone number already exists in the system', 409));

    const SuperAdmin = require('../../model/superAdminSchema');
    const saExists = await SuperAdmin.exists({ phoneNumber: digits });
    if (saExists) return next(createHttpError('This phone number already exists in the system', 409));

    const adminExists = await lookupSocietyAdminByMobile(digits);
    if (adminExists) return next(createHttpError('This phone number already exists in the system', 409));

    let person = await DailyHelp.findOne({ societyId: unitDoc.societyId, category: canonicalCategory, phoneDigits: digits });

    if (!person) {
      person = await DailyHelp.create({
        societyId: unitDoc.societyId,
        category: canonicalCategory,
        name: nm,
        countryCode: normalizedCode,
        phoneNumber: phoneNumber,
        phoneDigits: digits,
        comparablePhone: comparable,
        imageUrl: formattedImage,
        status: 'PENDING',
        createdByUserId: authUser._id,
        createdByRole: authUser.role,
      });
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const existingAssignment = await DailyHelpAssignment.findOne({ dailyHelpId: person._id, unitId: canonicalUnitId });
    if (existingAssignment) {
      return sendSuccessResponse(res, 200, 'Daily help already added for unit', {
        data: {
          id: String(existingAssignment._id),
          unitId: String(unitDoc._id),
          dailyHelpId: String(person._id),
          name: person.name,
          category: person.category,
          countryCode: person.countryCode,
          phoneNumber: person.phoneNumber,
          imageUrl: person.imageUrl,
          status: existingAssignment.status,
          createdAt: existingAssignment.createdAt,
          updatedAt: existingAssignment.updatedAt,
        },
      });
    }

    const assignmentStatus = person.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
    const assignment = await DailyHelpAssignment.create({
      dailyHelpId: person._id,
      unitId: canonicalUnitId,
      memberId: authUser._id,
      status: assignmentStatus,
    });

    return sendSuccessResponse(res, 201, 'Daily help added successfully', {
      data: {
        id: String(assignment._id),
        unitId: String(unitDoc._id),
        dailyHelpId: String(person._id),
        name: person.name,
        category: person.category,
        countryCode: person.countryCode,
        phoneNumber: person.phoneNumber,
        imageUrl: person.imageUrl,
        status: assignment.status,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add daily help'));
  }
};

const mapUiStatusToCanonical = (value) => {
  const v = normalizeString(value).toLowerCase();
  if (!v) return '';
  if (v === 'pending') return 'PENDING';
  if (v === 'approved') return 'APPROVED';
  if (v === 'rejected') return 'REJECTED';
  if (v === 'removed') return 'REMOVED';
  return '';
};

const getDailyHelpByStatus = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can view daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.query || {}).unitId);
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const assignments = await DailyHelpAssignment.find({ unitId: canonicalUnitId, status: { $in: ['APPROVED', 'PENDING'] } }).sort({ createdAt: -1 }).lean();

    const ids = assignments.map((a) => a.dailyHelpId);
    const persons = await DailyHelp.find({ _id: { $in: ids } }).lean();
    const map = persons.reduce((acc, p) => { acc[String(p._id)] = p; return acc; }, {});

    return sendSuccessResponse(res, 200, 'Daily help fetched successfully', {
      data: assignments.map((a) => {
        const p = map[String(a.dailyHelpId)] || {};
        return {
          id: String(a._id),
          unitId: String(unitDoc._id),
          dailyHelpId: String(a.dailyHelpId),
          name: p.name || null,
          category: p.category || null,
          countryCode: p.countryCode || '+91',
          phoneNumber: p.phoneNumber || null,
          imageUrl: p.imageUrl || null,
          status: a.status,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        };
      }),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help'));
  }
};


const searchApprovedSocietyDailyHelp = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can view daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.query || {}).unitId);
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const categoryRaw = (req.params && req.params.category) || '';
    if (!categoryRaw) return next(createHttpError('category path parameter is required', 400));
    const canonicalCategory = toCanonicalCategory(categoryRaw);
    if (!canonicalCategory || !ALLOWED_WORK_CATEGORY_IDS.has(canonicalCategory)) {
      return next(createHttpError('Invalid category', 400));
    }

    const docs = await DailyHelp.find({ societyId: unitDoc.societyId, status: 'APPROVED', category: canonicalCategory })
      .sort({ name: 1 })
      .lean();

    return sendSuccessResponse(res, 200, 'Daily help fetched successfully', {
      data: docs.map((d) => ({
        id: String(d._id),
        societyId: String(d.societyId),
        name: d.name,
        category: d.category,
        countryCode: d.countryCode || '+91',
        phoneNumber: d.phoneNumber || null,
        imageUrl: d.imageUrl || null,
        status: d.status,
        approvedAt: d.approvedAt || null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help'));
  }
};

const removeDailyHelpFromUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can remove daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId);
    const dailyHelpIdCandidate = normalizeString((req.params && (req.params.dailyHelpId || req.params.id)) || (req.body || {}).dailyHelpId);

    if (!dailyHelpIdCandidate) return next(createHttpError('dailyHelpId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const assignment = await DailyHelpAssignment.findOne({ unitId: canonicalUnitId, dailyHelpId: dailyHelpIdCandidate });
    if (!assignment) return next(createHttpError('Daily help assignment not found', 404));

    if (assignment.status === 'REMOVED') {
      return sendSuccessResponse(res, 200, 'Daily help already removed', {
        data: {
          id: String(assignment._id),
          unitId: String(unitDoc._id),
          status: assignment.status,
          removedAt: assignment.removedAt,
          updatedAt: assignment.updatedAt,
        },
      });
    }

    assignment.status = 'REMOVED';
    assignment.removedAt = new Date();
    await assignment.save();

    return sendSuccessResponse(res, 200, 'Daily help removed from unit successfully', {
      data: {
        id: String(assignment._id),
        unitId: String(unitDoc._id),
        status: assignment.status,
        removedAt: assignment.removedAt,
        updatedAt: assignment.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove daily help'));
  }
};


const editDailyHelpProfile = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can edit daily help', 403));

    const body = req.body || {};
    const unitIdCandidate = normalizeString(
      (req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId
    );
    const dailyHelpIdCandidate = normalizeString(
      (req.params && (req.params.dailyHelpId || req.params.id)) || (req.body || {}).dailyHelpId
    );

    if (!dailyHelpIdCandidate) return next(createHttpError('dailyHelpId is required', 400));
    if (!unitIdCandidate) return next(createHttpError('unitId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const doc = await DailyHelp.findById(dailyHelpIdCandidate);
    if (!doc) return next(createHttpError('Daily help not found', 404));
    if (String(doc.societyId) !== String(unitDoc.societyId)) {
      return next(createHttpError('Forbidden: daily help does not belong to this society', 403));
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const assignment = await DailyHelpAssignment.findOne({ unitId: canonicalUnitId, dailyHelpId: doc._id });
    if (!assignment || assignment.status === 'REMOVED') {
      return next(createHttpError('Forbidden: you do not have access to edit this profile', 403));
    }

    const { category, name, phoneNumber, imageUrl, countryCode } = body;
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
    const updates = {};

    if (category !== undefined) {
      const canonicalCategory = toCanonicalCategory(category);
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

        const fmExists = await FamilyMember.exists({ phoneDigits: digits });
        if (fmExists) return next(createHttpError('This phone number already exists in the system', 409));

        const SuperAdmin = require('../../model/superAdminSchema');
        const saExists = await SuperAdmin.exists({ phoneNumber: digits });
        if (saExists) return next(createHttpError('This phone number already exists in the system', 409));

        const adminExists = await lookupSocietyAdminByMobile(digits);
        if (adminExists) return next(createHttpError('This phone number already exists in the system', 409));

        const nextCategory = updates.category !== undefined ? updates.category : doc.category;
        const dup = await DailyHelp.exists({
          societyId: doc.societyId,
          category: nextCategory,
          phoneDigits: digits,
          _id: { $ne: doc._id },
        });
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
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update daily help profile'));
  }
};

const getDailyHelpProfileById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can view daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.query || {}).unitId);
    const dailyHelpIdCandidate = normalizeString((req.params && (req.params.dailyHelpId || req.params.id)) || (req.query || {}).dailyHelpId);

    if (!unitIdCandidate) return next(createHttpError('unitId path parameter is required', 400));
    if (!dailyHelpIdCandidate) return next(createHttpError('dailyHelpId path parameter is required', 400));
    if (!mongoose.Types.ObjectId.isValid(dailyHelpIdCandidate)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const doc = await DailyHelp.findById(dailyHelpIdCandidate).lean();
    if (!doc) return next(createHttpError('Daily help not found', 404));
    if (String(doc.societyId) !== String(unitDoc.societyId)) {
      return next(createHttpError('Daily help does not belong to the provided unit', 403));
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const assignment = await DailyHelpAssignment.findOne({ unitId: canonicalUnitId, dailyHelpId: doc._id }).lean();
    if (!assignment || assignment.status === 'REMOVED') {
      return next(createHttpError('Forbidden: you do not have access to this profile', 403));
    }

    return sendSuccessResponse(res, 200, 'Daily help profile fetched successfully', {
      data: {
        id: String(doc._id),
        unitId: String(unitDoc._id),
        dailyHelpId: String(doc._id),
        name: doc.name,
        category: doc.category,
        countryCode: doc.countryCode || '+91',
        phoneNumber: doc.phoneNumber || null,
        imageUrl: doc.imageUrl || null,
        status: assignment.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch daily help profile'));
  }
};

const assignExistingDailyHelpToUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member') return next(createHttpError('Only members can add daily help', 403));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId);
    const dailyHelpIdCandidate = normalizeString((req.params && (req.params.dailyHelpId || req.params.id)) || (req.body || {}).dailyHelpId);

    if (!unitIdCandidate) return next(createHttpError('unitId path parameter is required', 400));
    if (!dailyHelpIdCandidate) return next(createHttpError('dailyHelpId path parameter is required', 400));
    if (!mongoose.Types.ObjectId.isValid(dailyHelpIdCandidate)) {
      return next(createHttpError('Invalid dailyHelpId', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const person = await DailyHelp.findById(dailyHelpIdCandidate);
    if (!person) return next(createHttpError('Daily help not found', 404));
    if (String(person.societyId) !== String(unitDoc.societyId)) {
      return next(createHttpError('Forbidden: daily help does not belong to this society', 403));
    }
    if (person.status !== 'APPROVED') {
      return next(createHttpError('Daily help must be approved to add directly', 400));
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    let existing = await DailyHelpAssignment.findOne({ dailyHelpId: person._id, unitId: canonicalUnitId });
    if (existing) {
      if (existing.status === 'REMOVED') {
        existing.status = 'APPROVED';
        existing.removedAt = null;
        await existing.save();
        return sendSuccessResponse(res, 200, 'Daily help re-added to unit successfully', {
          data: {
            id: String(existing._id),
            unitId: String(unitDoc._id),
            dailyHelpId: String(person._id),
            name: person.name,
            category: person.category,
            countryCode: person.countryCode || '+91',
            phoneNumber: person.phoneNumber || null,
            imageUrl: person.imageUrl || null,
            status: existing.status,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          },
        });
      }
      return sendSuccessResponse(res, 200, 'Daily help already added for unit', {
        data: {
          id: String(existing._id),
          unitId: String(unitDoc._id),
          dailyHelpId: String(person._id),
          name: person.name,
          category: person.category,
          countryCode: person.countryCode || '+91',
          phoneNumber: person.phoneNumber || null,
          imageUrl: person.imageUrl || null,
          status: existing.status,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      });
    }

    const assignment = await DailyHelpAssignment.create({
      dailyHelpId: person._id,
      unitId: canonicalUnitId,
      memberId: authUser._id,
      status: 'APPROVED',
    });

    return sendSuccessResponse(res, 201, 'Daily help added to unit successfully', {
      data: {
        id: String(assignment._id),
        unitId: String(unitDoc._id),
        dailyHelpId: String(person._id),
        name: person.name,
        category: person.category,
        countryCode: person.countryCode || '+91',
        phoneNumber: person.phoneNumber || null,
        imageUrl: person.imageUrl || null,
        status: assignment.status,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add daily help to unit'));
  }
};

module.exports = {
  getDailyHelpCategories,
  addDailyHelp,
  getDailyHelpByStatus,
  removeDailyHelpFromUnit,
  editDailyHelpProfile,
  getDailyHelpProfileById,
  searchApprovedSocietyDailyHelp,
  assignExistingDailyHelpToUnit,
};
