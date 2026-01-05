const Announcement = require('../../model/announcementSchema');
const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const { assertUnitResidentAccess } = require('../../utils/unitAccess');

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

const validateAnnouncementPayload = (payload = {}, options = {}) => {
  const isPartial = !!options.isPartial;

  const titleRaw = payload.title;
  const descriptionRaw = payload.descriptionHtml;
  const photoRaw = payload.photo;
  const photosRaw = payload.photos;
  const attachmentsRaw = payload.attachments;

  const validated = {};

  if (!isPartial || titleRaw !== undefined) {
    const title = normalizeString(titleRaw);
    if (!title) {
      throw createHttpError('Announcement title is required', 400);
    }
    if (title.length < 3 || title.length > 200) {
      throw createHttpError('Announcement title must be between 3 and 200 characters', 400);
    }
    validated.title = titleRaw.toString();
  }

  if (!isPartial || descriptionRaw !== undefined) {
    const desc =
      descriptionRaw !== undefined && descriptionRaw !== null
        ? descriptionRaw.toString()
        : '';
    if (!desc && !isPartial) {
      throw createHttpError('Announcement description is required', 400);
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

    const cleanedPhotos = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0)
      .map((value) =>
        ensureBase64ImageDataUrl({
          value,
          fieldLabel: 'Announcement photo',
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

const createAnnouncement = async (req, res, next) => {
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
      validated = validateAnnouncementPayload(req.body || {}, { isPartial: false });
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
      return next(createHttpError('Unauthorized', 401));
    }

    const viewAsRaw = normalizeString(
      (req.body && req.body.viewAs) ||
        (req.params && req.params.viewAs) ||
        (req.query && req.query.viewAs) ||
        ''
    );
    const viewAs = viewAsRaw.toLowerCase();
    const isMemberView = authUser.role === 'member' || viewAs === 'member';

    let societyId = null;

    if (
      (authUser.adminSocietyId || authUser.linkedSocietyAdminId || authUser.role === 'society_admin') &&
      !isMemberView
    ) {
      const society = await resolveAdminSociety(authUser);
      societyId = society._id;
    } else if (isMemberView) {
      const unitIdCandidate = normalizeString(
        (req.body && req.body.unitId) ||
        (req.params && (req.params.unitId || req.params.id)) ||
        (req.query && (req.query.unitId || req.query.id)) ||
        ''
      );

      if (!unitIdCandidate) {
        return next(createHttpError('unitId is required to view announcements', 400));
      }

      let unitDoc;
      try {
        unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
      } catch (e) {
        return next(e);
      }

      societyId = unitDoc.societyId;
    } else {
      return next(createHttpError('Only members or society admins can perform this action', 403));
    }

    const items = await Announcement.find({ societyId, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();

    let lastAnnouncementsSeenAtTs = null;
    if (isMemberView) {
      const lastSeen =
        authUser.lastAnnouncementsSeenAt instanceof Date
          ? authUser.lastAnnouncementsSeenAt
          : authUser.lastAnnouncementsSeenAt
          ? new Date(authUser.lastAnnouncementsSeenAt)
          : null;
      lastAnnouncementsSeenAtTs = lastSeen ? lastSeen.getTime() : null;
    }

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

      let isRead = true;
      if (isMemberView) {
        if (lastAnnouncementsSeenAtTs) {
          isRead = createdAt.getTime() <= lastAnnouncementsSeenAtTs;
        } else {
          isRead = true;
        }
      }

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



    return sendSuccessResponse(res, 200, 'Announcements fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch announcements'));
  }
};

const getAnnouncementById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    const viewAsRaw = normalizeString(
      (req.body && req.body.viewAs) ||
        (req.params && req.params.viewAs) ||
        (req.query && req.query.viewAs) ||
        ''
    );
    const viewAs = viewAsRaw.toLowerCase();
    const isMemberView = authUser.role === 'member' || viewAs === 'member';

    const announcementId = normalizeString(
      (req.body && req.body.announcementId) ||
      (req.params && req.params.announcementId) ||
      (req.query && req.query.announcementId) ||
      ''
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required', 400));
    }

    let societyId = null;
    let doc = null;

    if (
      (authUser.adminSocietyId || authUser.linkedSocietyAdminId || authUser.role === 'society_admin') &&
      !isMemberView
    ) {
      const society = await resolveAdminSociety(authUser);
      societyId = society._id;
    } else if (isMemberView) {
      const unitIdCandidate = normalizeString(
        (req.body && req.body.unitId) ||
        (req.params && (req.params.unitId || req.params.id)) ||
        (req.query && (req.query.unitId || req.query.id)) ||
        ''
      );

      if (!unitIdCandidate) {
        return next(createHttpError('unitId is required to view announcements', 400));
      }

      let unitDoc;
      try {
        unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
      } catch (e) {
        return next(e);
      }

      societyId = unitDoc.societyId;
    } else {
      return next(createHttpError('Only members or society admins can perform this action', 403));
    }

    doc = await Announcement.findOne({
      announcementId,
      societyId,
      deletedAt: null,
    }).lean();

    if (!doc) {
      return next(createHttpError('Announcement not found', 404));
    }

    if (isMemberView) {
      const createdAt =
        doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;

      if (createdAt) {
        const lastSeenRaw = authUser.lastAnnouncementsSeenAt;
        const lastSeen =
          lastSeenRaw instanceof Date ? lastSeenRaw : lastSeenRaw ? new Date(lastSeenRaw) : null;
        const lastSeenTs = lastSeen ? lastSeen.getTime() : 0;
        const createdAtTs = createdAt.getTime();

        if (createdAtTs > lastSeenTs) {
          await User.findByIdAndUpdate(authUser._id, { lastAnnouncementsSeenAt: createdAt }).exec();
        }
      }
    }

    const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);

    return sendSuccessResponse(res, 200, 'Announcement fetched successfully', {
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
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const announcementId = normalizeString(
      ((req.body || {}).announcementId) ||
      ((req.params && req.params.announcementId) || '')
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required', 400));
    }

    const doc = await Announcement.findOne({
      announcementId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Announcement not found', 404));
    }

    let validated;
    try {
      validated = validateAnnouncementPayload(req.body || {}, { isPartial: true });
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
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const announcementId = normalizeString(
      ((req.body || {}).announcementId) ||
      ((req.params && req.params.announcementId) || '')
    );
    if (!announcementId) {
      return next(createHttpError('announcementId path parameter is required', 400));
    }

    const doc = await Announcement.findOne({
      announcementId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Announcement not found', 404));
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
