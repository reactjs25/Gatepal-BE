const Announcement = require('../../model/announcementSchema');
const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { toISTDateLabel, toISTTimeLabel } = require('../../utils/dateTime');

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

    return sendSuccessResponse(res, 201, 'Announcement created successfully', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        title: doc.title,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        monthLabel: toISTDateLabel(doc.createdAt),
        timeLabel: toISTTimeLabel(doc.createdAt),
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

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const items = await Announcement.find({ societyId: society._id, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();

    const data = items.map((doc) => ({
      announcementId: doc.announcementId,
      societyId: String(doc.societyId),
      createdByUserId: String(doc.createdByUserId),
      title: doc.title,
      contentHtml: doc.contentHtml,
      photos: Array.isArray(doc.photos) ? doc.photos : [],
      attachments: doc.attachments || [],
      monthLabel: toISTDateLabel(doc.createdAt),
      timeLabel: toISTTimeLabel(doc.createdAt),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));

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
    }).lean();

    if (!doc) {
      return next(createHttpError('Announcement not found', 404));
    }

    return sendSuccessResponse(res, 200, 'Announcement fetched successfully', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        title: doc.title,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        monthLabel: toISTDateLabel(doc.createdAt),
        timeLabel: toISTTimeLabel(doc.createdAt),
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

    return sendSuccessResponse(res, 200, 'Announcement updated successfully', {
      data: {
        announcementId: doc.announcementId,
        societyId: String(doc.societyId),
        createdByUserId: String(doc.createdByUserId),
        title: doc.title,
        contentHtml: doc.contentHtml,
        photos: Array.isArray(doc.photos) ? doc.photos : [],
        attachments: doc.attachments || [],
        monthLabel: toISTDateLabel(doc.createdAt),
        timeLabel: toISTTimeLabel(doc.createdAt),
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

    return sendSuccessResponse(res, 200, 'Announcement deleted successfully', {
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
