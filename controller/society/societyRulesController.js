const SocietyRule = require('../../model/societyRuleSchema');
const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { toISTDateTimeLabel } = require('../../utils/dateTime');

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
  const photoRaw = payload.photo;
  const photosRaw = payload.photos;
  const attachmentsRaw = payload.attachments;

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

  if (!isPartial || photoRaw !== undefined || photosRaw !== undefined) {
    let sources = [];

    if (Array.isArray(photosRaw)) {
      sources = photosRaw;
    } else if (Array.isArray(photoRaw)) {
      sources = photoRaw;
    } else if (photoRaw === null || photoRaw === undefined || photoRaw === '') {
      sources = [];
    } else if (photoRaw !== undefined) {
      sources = [photoRaw];
    }

    const cleanedPhotos = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0)
      .map((value) =>
        ensureBase64ImageDataUrl({
          value,
          fieldLabel: 'Society rule photo',
        })
      );

    validated.photos = cleanedPhotos;
  }

  if (!isPartial || attachmentsRaw !== undefined) {
    if (attachmentsRaw == null) {
      validated.attachments = [];
    } else if (!Array.isArray(attachmentsRaw)) {
      throw createHttpError('attachments must be an array of base64 strings', 400);
    } else {
      const cleaned = attachmentsRaw
        .map((entry) => (entry == null ? '' : entry.toString().trim()))
        .filter((entry) => entry.length > 0);
      validated.attachments = cleaned;
    }
  }

  return validated;
};

const buildCreatedAndUpdatedOn = (doc) => {
  if (!doc) {
    return {
      createdOn: '',
      updatedOn: '',
    };
  }

  const createdAt =
    doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
  const updatedAt =
    doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(doc.updatedAt) : null;

  const createdOn = createdAt ? toISTDateTimeLabel(createdAt) : '';

  let updatedOn = '';
  if (createdAt && updatedAt && updatedAt.getTime() !== createdAt.getTime()) {
    updatedOn = toISTDateTimeLabel(updatedAt);
  }

  return {
    createdOn,
    updatedOn,
  };
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
      photos: validated.photos || [],
      attachments: validated.attachments,
    });

    const category = findCategoryByKey(doc.categoryKey);
    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 201, 'Society rule created successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
      
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        createdOn,
        updatedOn,
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
      const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

      return {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
       
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        createdOn,
        updatedOn,
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
    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 200, 'Society rule fetched successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
      
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        createdOn,
        updatedOn,
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

    const rawBody = req.body || {};
    const { categoryKey, categoryLabel, ...mutableBody } = rawBody;

    let validated;
    try {
      validated = validateSocietyRulePayload(mutableBody, { isPartial: true });
    } catch (e) {
      return next(e);
    }

    if (validated.contentHtml !== undefined) {
      doc.contentHtml = validated.contentHtml;
    }
    if (validated.photos !== undefined) {
      doc.photos = validated.photos;
    }
    if (validated.attachments !== undefined) {
      doc.attachments = validated.attachments;
    }

    await doc.save();

    const category = findCategoryByKey(doc.categoryKey);
    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 200, 'Society rule updated successfully', {
      data: {
        ruleId: doc.ruleId,
        societyId: String(doc.societyId),
     
        categoryKey: doc.categoryKey,
        categoryLabel: category ? category.label : doc.categoryKey,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        createdOn,
        updatedOn,
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

    const notAdded = [];
    const added = [];

    SOCIETY_RULE_CATEGORIES.forEach((category) => {
      const count = categoryCounts.get(category.key) || 0;
      const item = {
        key: category.key,
        label: category.label,
        status: count > 0 ? 'added' : 'not_added',
        ruleCount: count,
      };
      if (count > 0) {
        added.push(item);
      } else {
        notAdded.push(item);
      }
    });

    return sendSuccessResponse(res, 200, 'Society rule categories fetched successfully', {
      data: {
        not_added: notAdded,
        added,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society rule categories'));
  }
};

module.exports = {
  SOCIETY_RULE_CATEGORIES,
  createSocietyRule,
  getSocietyRules,
  updateSocietyRuleById,
  deleteSocietyRuleById,
  getSocietyRuleCategories,
};
