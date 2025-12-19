const SocietyRule = require('../../model/societyRuleSchema');
const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

const SOCIETY_RULE_CATEGORIES = [
  { key: 'general', label: 'General' },
  { key: 'parking_vehicles', label: 'Parking & Vehicles' },
  { key: 'security_safety', label: 'Security & Safety' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'amenities_usage', label: 'Amenities Usage' },
  { key: 'events_celebrations', label: 'Events & Celebrations' },
  { key: 'pets_animals', label: 'Pets & Animals' },
  { key: 'construction_renovation', label: 'Construction & Renovation' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'legal_compliance', label: 'Legal & Compliance' },
  { key: 'rent_pg', label: 'Rent & P.G.' },
  { key: 'other', label: 'Other' },
];

const CATEGORY_KEY_SET = new Set(SOCIETY_RULE_CATEGORIES.map((c) => c.key));

const findCategoryByKey = (key) => {
  const canonical = (key || '').toString().trim().toLowerCase();
  return SOCIETY_RULE_CATEGORIES.find((c) => c.key === canonical) || null;
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

const validateSocietyRulePayload = (payload = {}, options = {}) => {
  const isPartial = !!options.isPartial;

  const categoryKeyRaw = payload.categoryKey;
  const contentRaw = payload.contentHtml;

  const validated = {};

  if (!isPartial || categoryKeyRaw !== undefined) {
    const categoryKey = normalizeString(categoryKeyRaw || '').toLowerCase();
    if (!categoryKey) {
      throw createHttpError('categoryKey is required', 400);
    }
    if (!CATEGORY_KEY_SET.has(categoryKey)) {
      throw createHttpError('Invalid categoryKey for society rule', 400);
    }
    validated.categoryKey = categoryKey;
  }

  if (!isPartial || contentRaw !== undefined) {
    const content =
      contentRaw !== undefined && contentRaw !== null ? contentRaw.toString() : '';
    if (!content && !isPartial) {
      throw createHttpError('Rule contentHtml is required', 400);
    }
    if (content) {
      validated.contentHtml = content;
    } else if (!isPartial) {
      validated.contentHtml = '';
    }
  }

  return validated;
};

const createSocietyRule = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    let validated;
    try {
      validated = validateSocietyRulePayload(req.body || {}, { isPartial: false });
    } catch (e) {
      return next(e);
    }

    const doc = await SocietyRule.create({
      societyId: society._id,
      createdByUserId: authUser._id,
      categoryKey: validated.categoryKey,
      contentHtml: validated.contentHtml,
    });

    const category = findCategoryByKey(doc.categoryKey);

    return sendSuccessResponse(res, 201, 'Society rule created successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create society rule'));
  }
};

const getSocietyRules = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const categoryKeyRaw =
      (req.query && req.query.categoryKey) ||
      ((req.body || {}).categoryKey) ||
      '';
    let filter = { societyId: society._id, deletedAt: null };

    if (categoryKeyRaw !== undefined && categoryKeyRaw !== null && categoryKeyRaw !== '') {
      const categoryKey = normalizeString(categoryKeyRaw || '').toLowerCase();
      if (!CATEGORY_KEY_SET.has(categoryKey)) {
        return next(createHttpError('Invalid categoryKey for society rule', 400));
      }
      filter.categoryKey = categoryKey;
    }

    const items = await SocietyRule.find(filter).sort({ createdAt: -1 }).lean();

    const data = items.map((doc) => {
      const category = findCategoryByKey(doc.categoryKey);
      return {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    return sendSuccessResponse(res, 200, 'Society rules fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society rules'));
  }
};

const getSocietyRuleById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const ruleId = normalizeString(
      ((req.body || {}).ruleId) || ((req.params && req.params.ruleId) || '')
    );
    if (!ruleId) {
      return next(createHttpError('ruleId path parameter is required', 400));
    }

    const doc = await SocietyRule.findOne({
      ruleId,
      societyId: society._id,
      deletedAt: null,
    }).lean();

    if (!doc) {
      return next(createHttpError('Society rule not found', 404));
    }

    const category = findCategoryByKey(doc.categoryKey);

    return sendSuccessResponse(res, 200, 'Society rule fetched successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society rule'));
  }
};

const updateSocietyRuleById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const ruleId = normalizeString(
      ((req.body || {}).ruleId) || ((req.params && req.params.ruleId) || '')
    );
    if (!ruleId) {
      return next(createHttpError('ruleId path parameter is required', 400));
    }

    const doc = await SocietyRule.findOne({
      ruleId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Society rule not found', 404));
    }

    let validated;
    try {
      validated = validateSocietyRulePayload(req.body || {}, { isPartial: true });
    } catch (e) {
      return next(e);
    }

    if (validated.categoryKey !== undefined) {
      doc.categoryKey = validated.categoryKey;
    }
    if (validated.contentHtml !== undefined) {
      doc.contentHtml = validated.contentHtml;
    }

    await doc.save();

    const category = findCategoryByKey(doc.categoryKey);

    return sendSuccessResponse(res, 200, 'Society rule updated successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update society rule'));
  }
};

const deleteSocietyRuleById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const ruleId = normalizeString(
      ((req.body || {}).ruleId) || ((req.params && req.params.ruleId) || '')
    );
    if (!ruleId) {
      return next(createHttpError('ruleId path parameter is required', 400));
    }

    const doc = await SocietyRule.findOne({
      ruleId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Society rule not found', 404));
    }

    const deletedAt = new Date();
    doc.deletedAt = deletedAt;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Society rule deleted successfully', {
      data: {
        ruleId: doc.ruleId,
        deletedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete society rule'));
  }
};

const getSocietyRuleCategories = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const rules = await SocietyRule.find({
      societyId: society._id,
      deletedAt: null,
    })
      .select('categoryKey')
      .lean();

    const categoryCounts = new Map();
    for (const rule of rules) {
      const key = rule.categoryKey;
      if (!key) continue;
      categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
    }

    const data = SOCIETY_RULE_CATEGORIES.map((category) => {
      const count = categoryCounts.get(category.key) || 0;
      return {
        key: category.key,
        label: category.label,
        status: count > 0 ? 'added' : 'not_added',
        ruleCount: count,
      };
    });

    return sendSuccessResponse(res, 200, 'Society rule categories fetched successfully', {
      data,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society rule categories'));
  }
};

module.exports = {
  SOCIETY_RULE_CATEGORIES,
  createSocietyRule,
  getSocietyRules,
  getSocietyRuleById,
  updateSocietyRuleById,
  deleteSocietyRuleById,
  getSocietyRuleCategories,
};

