const mongoose = require('mongoose');
const Announcement = require('../../model/announcementSchema');
const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const {
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
} = require('../../utils/adminSocietyContext');
const { normalizeImageListToStorageUrls } = require('../../utils/imageDataUrl');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const { assertUnitResidentAccess } = require('../../utils/unitAccess');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { sendToSocietyMembers } = require('../../utils/pushNotificationService');
const { getNotificationMessage } = require('../../utils/notificationMessages');

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const resolveAdminSociety = async (req, authUser) => {
  const unitIdCandidate = normalizeString(
    getLastBodyValue((req.body && req.body.unitId)) ||
      (req.params && (req.params.unitId || req.params.id)) ||
      (req.query && (req.query.unitId || req.query.id)) ||
      ''
  );

  if (unitIdCandidate) {
    if (!mongoose.Types.ObjectId.isValid(unitIdCandidate)) {
      throw createHttpError('Invalid unitId.', 400);
    }

    const unitDoc = await MemberUnit.findById(unitIdCandidate, { societyId: 1 }).lean();
    if (!unitDoc) {
      throw createHttpError('Unit not found.', 404);
    }

    await assertAdminAccessToSociety({ req, authUser, societyId: unitDoc.societyId });
    const society = await Society.findById(unitDoc.societyId).lean();
    if (!society) {
      throw createHttpError('Society not found.', 404);
    }
    return society;
  }

  return resolveAdminSocietyFromContext({ req, authUser });
};

const assertAdminAccessToSociety = async ({ req, authUser, societyId }) => {
  const linkedAdminIds = Array.from(
    new Set(
      [
        req?.user?.societyAdminId,
        authUser?.linkedSocietyAdminId,
        ...((authUser?.linkedSocietyAdminIds || []).map((id) => String(id))),
      ]
        .filter(Boolean)
        .map((id) => String(id))
    )
  );

  if (linkedAdminIds.length > 0) {
    const allowed = await Society.exists({
      _id: societyId,
      'societyAdmins._id': { $in: linkedAdminIds },
    });
    if (allowed) {
      return;
    }
  }

  const phoneMatches = await lookupSocietyAdminsByMobile(authUser?.phoneNumber || '');
  const hasPhoneMappedAccess = phoneMatches.some(
    (match) => String(match.societyId) === String(societyId)
  );
  if (hasPhoneMappedAccess) {
    return;
  }

  throw createHttpError('Forbidden: you are not mapped as admin for this society.', 403);
};

const validateAnnouncementPayload = async (payload = {}, options = {}) => {
  const isPartial = !!options.isPartial;
  const storagePrefix = normalizeString(options.storagePrefix) || 'announcements';

  const titleRaw = getLastBodyValue(payload.title);
  const descriptionRaw = getLastBodyValue(payload.descriptionHtml);
  const photoRaw =
    payload.photo !== undefined
      ? payload.photo
      : payload.image !== undefined
        ? payload.image
        : payload.imageUrl;
  const photosRaw = payload.photos !== undefined ? payload.photos : payload.images;
  const attachmentsRaw = payload.attachments !== undefined ? payload.attachments : payload.attachment;

  const validated = {};

  if (!isPartial || titleRaw !== undefined) {
    const title = normalizeString(titleRaw);
    if (!title) {
      throw createHttpError('Announcement title is required.', 400);
    }
    if (title.length < 3 || title.length > 200) {
      throw createHttpError('Announcement title must be between 3 and 200 characters.', 400);
    }
    validated.title = titleRaw.toString();
  }

  if (!isPartial || descriptionRaw !== undefined) {
    const desc =
      descriptionRaw !== undefined && descriptionRaw !== null
        ? descriptionRaw.toString()
        : '';
    if (!desc && !isPartial) {
      throw createHttpError('Announcement description is required.', 400);
    }
    if (desc) {
      validated.contentHtml = desc;
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

    const cleanedPhotoInputs = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0);

    let cleanedPhotos = [];
    try {
      cleanedPhotos = await normalizeImageListToStorageUrls({
        values: cleanedPhotoInputs,
        fieldLabel: 'Announcement photo',
        keyPrefix: storagePrefix,
        fileNamePrefix: 'announcement-photo',
      });
    } catch (e) {
      throw createHttpError(e.message, 400);
    }

    validated.photos = cleanedPhotos;
  }

  if (!isPartial || attachmentsRaw !== undefined) {
    if (attachmentsRaw == null) {
      validated.attachments = [];
    } else {
      const attachmentItems = Array.isArray(attachmentsRaw) ? attachmentsRaw : [attachmentsRaw];
      const cleaned = attachmentItems
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

const createAnnouncement = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    let validated;
    try {
      validated = await validateAnnouncementPayload(req.body || {}, {
        isPartial: false,
        storagePrefix: `announcements/${String(society._id)}`,
      });
    } catch (e) {
      return next(e);
    }

    const doc = await Announcement.create({
      societyId: society._id,
      createdByUserId: authUser._id,
      title: validated.title,
      contentHtml: validated.contentHtml,
      photos: validated.photos || [],
      attachments: validated.attachments,
    });

    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    
    sendToSocietyMembers(
      society._id,
      'New Announcement',
      validated.title,
      {
        type: 'announcement',
        announcementId: doc.announcementId,
        societyId: String(society._id),
      },
      {
        roles: ['member', 'guard'],
        localizedContentResolver: ({ languageCode }) =>
          getNotificationMessage(
            'announcement_new',
            {
              announcementTitle: validated.title,
            },
            languageCode
          ),
      }
    ).catch((err) => {
      console.error('[Announcement] Failed to send push notification:', err.message);
    });

    return sendSuccessResponse(res, 201, 'Announcement details saved successfully.', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        title: doc.title,
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
    return next(setErrorDefaults(error, 'Failed to create announcement'));
  }
};

const getAnnouncements = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const viewAsRaw = normalizeString(
      getLastBodyValue((req.body && req.body.viewAs)) ||
        (req.params && req.params.viewAs) ||
        (req.query && req.query.viewAs) ||
        ''
    );
    const viewAs = viewAsRaw.toLowerCase();
    const effectiveRole = req.user?.effectiveRole || authUser.role;
    const isMemberView = effectiveRole === 'member' || viewAs === 'member';
    const isGuardView = effectiveRole === 'guard';

    let societyId = null;

    if (
      isSocietyAdminPrincipal(req, authUser) &&
      !isMemberView
    ) {
      const unitIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.unitId)) ||
          (req.params && (req.params.unitId || req.params.id)) ||
          (req.query && (req.query.unitId || req.query.id)) ||
          ''
      );
      if (unitIdCandidate) {
        if (!mongoose.Types.ObjectId.isValid(unitIdCandidate)) {
          return next(createHttpError('Invalid unitId.', 400));
        }
        const unitDoc = await MemberUnit.findById(unitIdCandidate, { societyId: 1 }).lean();
        if (!unitDoc) {
          return next(createHttpError('Unit not found.', 404));
        }
        await assertAdminAccessToSociety({ req, authUser, societyId: unitDoc.societyId });
        societyId = unitDoc.societyId;
      } else {
        const society = await resolveAdminSociety(req, authUser);
        societyId = society._id;
      }
    } else if (isGuardView) {
      
      const societyIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.societyId)) ||
        (req.params && req.params.societyId) ||
        (req.query && req.query.societyId) ||
        ''
      );

      if (!societyIdCandidate) {
        return next(createHttpError('societyId is required for guards to view announcements.', 400));
      }

      
      const guardSocieties = authUser.guardSocieties || [];
      const isAssociatedWithSociety = guardSocieties.some(
        (gs) => String(gs.societyId) === societyIdCandidate
      );

      if (!isAssociatedWithSociety) {
        return next(createHttpError('Guard is not associated with this society.', 403));
      }

      societyId = societyIdCandidate;
    } else if (isMemberView) {
      const unitIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.unitId)) ||
        (req.params && (req.params.unitId || req.params.id)) ||
        (req.query && (req.query.unitId || req.query.id)) ||
        ''
      );

      if (!unitIdCandidate) {
        return next(createHttpError('unitId is required to view announcements.', 400));
      }

      let unitDoc;
      try {
        unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
      } catch (e) {
        return next(e);
      }

      societyId = unitDoc.societyId;
    } else {
      return next(createHttpError('Only members, guards, or society admins can perform this action.', 403));
    }

    const items = await Announcement.find({ societyId, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();

    const readAnnouncementIdsSet = (isMemberView || isGuardView)
      ? new Set(
          Array.isArray(authUser.readAnnouncementIds)
            ? authUser.readAnnouncementIds.map((id) => String(id))
            : []
        )
      : null;

    const groupsByKey = {};

    items.forEach((doc) => {
      const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
      const year = createdAt.getFullYear();
      const monthIndex = createdAt.getMonth();
      const monthName = MONTH_LABELS[monthIndex] || '';
      const monthLabel = monthName && Number.isFinite(year) ? `${monthName} ${year}` : '';
      const isCurrentMonth = year === currentYear && monthIndex === currentMonthIndex;
      const sectionLabel = isCurrentMonth ? 'This Month' : monthLabel || 'Unknown';
      const groupKey = isCurrentMonth
        ? `this_month_${year}_${String(monthIndex + 1).padStart(2, '0')}`
        : `month_${year}_${String(monthIndex + 1).padStart(2, '0')}`;

      if (!groupsByKey[groupKey]) {
        groupsByKey[groupKey] = {
          sectionLabel,
          monthLabel: monthLabel || null,
          announcements: [],
          year,
          monthIndex,
        };
      }

      const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

      const isRead = (isMemberView || isGuardView) ? readAnnouncementIdsSet.has(String(doc.announcementId)) : true;

      groupsByKey[groupKey].announcements.push({
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        title: doc.title,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        createdOn,
        updatedOn,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        isRead,
      });
    });

    const data = Object.values(groupsByKey).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.monthIndex - a.monthIndex;
    });



    return sendSuccessResponse(res, 200, 'Announcements fetched successfully.', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch announcements'));
  }
};

const getAnnouncementById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const viewAsRaw = normalizeString(
      getLastBodyValue((req.body && req.body.viewAs)) ||
        (req.params && req.params.viewAs) ||
        (req.query && req.query.viewAs) ||
        ''
    );
    const viewAs = viewAsRaw.toLowerCase();
    const effectiveRole = req.user?.effectiveRole || authUser.role;
    const isMemberView = effectiveRole === 'member' || viewAs === 'member';
    const isGuardView = effectiveRole === 'guard';

    const announcementId = normalizeString(
      getLastBodyValue((req.body && req.body.announcementId)) ||
      (req.params && req.params.announcementId) ||
      (req.query && req.query.announcementId) ||
      ''
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required.', 400));
    }

    let societyId = null;
    let doc = null;

    if (
      isSocietyAdminPrincipal(req, authUser) &&
      !isMemberView
    ) {
      const unitIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.unitId)) ||
          (req.params && (req.params.unitId || req.params.id)) ||
          (req.query && (req.query.unitId || req.query.id)) ||
          ''
      );
      if (unitIdCandidate) {
        if (!mongoose.Types.ObjectId.isValid(unitIdCandidate)) {
          return next(createHttpError('Invalid unitId.', 400));
        }
        const unitDoc = await MemberUnit.findById(unitIdCandidate, { societyId: 1 }).lean();
        if (!unitDoc) {
          return next(createHttpError('Unit not found.', 404));
        }
        await assertAdminAccessToSociety({ req, authUser, societyId: unitDoc.societyId });
        societyId = unitDoc.societyId;
      } else {
        const society = await resolveAdminSociety(req, authUser);
        societyId = society._id;
      }
    } else if (isGuardView) {
      
      const societyIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.societyId)) ||
        (req.params && req.params.societyId) ||
        (req.query && req.query.societyId) ||
        ''
      );

      if (!societyIdCandidate) {
        return next(createHttpError('societyId is required for guards to view announcements.', 400));
      }

      
      const guardSocieties = authUser.guardSocieties || [];
      const isAssociatedWithSociety = guardSocieties.some(
        (gs) => String(gs.societyId) === societyIdCandidate
      );

      if (!isAssociatedWithSociety) {
        return next(createHttpError('Guard is not associated with this society.', 403));
      }

      societyId = societyIdCandidate;
    } else if (isMemberView) {
      const unitIdCandidate = normalizeString(
        getLastBodyValue((req.body && req.body.unitId)) ||
        (req.params && (req.params.unitId || req.params.id)) ||
        (req.query && (req.query.unitId || req.query.id)) ||
        ''
      );

      if (!unitIdCandidate) {
        return next(createHttpError('unitId is required to view announcements.', 400));
      }

      let unitDoc;
      try {
        unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
      } catch (e) {
        return next(e);
      }

      societyId = unitDoc.societyId;
    } else {
      return next(createHttpError('Only members, guards, or society admins can perform this action.', 403));
    }

    doc = await Announcement.findOne({
      announcementId,
      societyId,
      deletedAt: null,
    }).lean();

    if (!doc) {
      return next(createHttpError('Announcement not found.', 404));
    }

    if (isMemberView || isGuardView) {
      await User.findByIdAndUpdate(authUser._id, {
        $addToSet: { readAnnouncementIds: String(doc.announcementId) },
      }).exec();
    }

    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 200, 'Announcement fetched successfully.', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        title: doc.title,
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
    return next(setErrorDefaults(error, 'Failed to fetch announcement'));
  }
};

const updateAnnouncementById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    const announcementId = normalizeString(
      getLastBodyValue(((req.body || {}).announcementId)) ||
      ((req.params && req.params.announcementId) || '')
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required.', 400));
    }

    const doc = await Announcement.findOne({
      announcementId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Announcement not found.', 404));
    }

    let validated;
    try {
      validated = await validateAnnouncementPayload(req.body || {}, {
        isPartial: true,
        storagePrefix: `announcements/${String(society._id)}`,
      });
    } catch (e) {
      return next(e);
    }

    if (validated.title !== undefined) {
      doc.title = validated.title;
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

    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 200, 'Announcement details updated successfully.', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        title: doc.title,
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
    return next(setErrorDefaults(error, 'Failed to update announcement'));
  }
};

const deleteAnnouncementById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    const announcementId = normalizeString(
      getLastBodyValue(((req.body || {}).announcementId)) ||
      ((req.params && req.params.announcementId) || '')
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required.', 400));
    }

    const doc = await Announcement.findOne({
      announcementId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Announcement not found.', 404));
    }

    const deletedAt = new Date();
    doc.deletedAt = deletedAt;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Announcement details deleted successfully.', {
      data: {
        announcementId: doc.announcementId,
        deletedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete announcement'));
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncementById,
  deleteAnnouncementById,
};








