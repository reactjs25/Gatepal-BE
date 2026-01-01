const Meeting = require('../../model/meetingSchema');
const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { toISTDateLabel, toISTTimeLabel, toISTDateTimeLabel } = require('../../utils/dateTime');
const { assertUnitResidentAccess } = require('../../utils/unitAccess');

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

const parseMeetingDateTime = (meetingDate, meetingStartingFrom) => {
  if (!meetingDate || !meetingStartingFrom) return null;
  const dateStr = meetingDate.toString().trim();
  const timeStr = meetingStartingFrom.toString().trim();
  if (!dateStr || !timeStr) return null;
  const combined = `${dateStr} ${timeStr}`;
  const d = new Date(combined);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError('meetingDate and meetingStartingFrom must form a valid date-time', 400);
  }
  return d;
};

const validateMeetingPayload = (payload = {}, options = {}) => {
  const isPartial = !!options.isPartial;

  const meetingDateRaw = payload.meetingDate;
  const startingFromRaw = payload.meetingStartingFrom;
  const venueRaw = payload.venue;
  const agendaRaw = payload.agendaHtml;
  const agendaPhotoRaw = payload.agendaPhoto;
  const agendaPhotosRaw = payload.agendaPhotos;
  const agendaAttachmentsRaw = payload.agendaAttachments;
  const discussionHtmlRaw = payload.discussionHtml;
  const discussionPhotoRaw = payload.discussionPhoto;
  const discussionPhotosRaw = payload.discussionPhotos;
  const discussionAttachmentsRaw = payload.discussionAttachments;

  const validated = {};

  if (!isPartial || meetingDateRaw !== undefined || startingFromRaw !== undefined) {
    const meetingDateStr =
      meetingDateRaw === undefined || meetingDateRaw === null
        ? ''
        : meetingDateRaw.toString().trim();
    const startingFromStr =
      startingFromRaw === undefined || startingFromRaw === null
        ? ''
        : startingFromRaw.toString().trim();

    if (!isPartial || meetingDateRaw !== undefined || startingFromRaw !== undefined) {
      if (!meetingDateStr || !startingFromStr) {
        if (!isPartial) {
          throw createHttpError('meetingDate and meetingStartingFrom are required', 400);
        }
        throw createHttpError(
          'Both meetingDate and meetingStartingFrom are required when updating meeting time',
          400
        );
      }
    }

    if (meetingDateStr && startingFromStr) {
      parseMeetingDateTime(meetingDateStr, startingFromStr);
      validated.meetingDate = meetingDateStr;
      validated.meetingStartingFrom = startingFromStr;
    }
  }

  if (!isPartial || venueRaw !== undefined) {
    const venue = normalizeString(venueRaw);
    if (!venue && !isPartial) {
      throw createHttpError('venue is required', 400);
    }
    if (venue) {
      validated.venue = venueRaw.toString();
    } else if (!isPartial) {
      validated.venue = '';
    }
  }

  if (!isPartial || agendaRaw !== undefined) {
    const agenda =
      agendaRaw !== undefined && agendaRaw !== null
        ? agendaRaw.toString()
        : '';
    if (!agenda && !isPartial) {
      throw createHttpError('agendaHtml is required', 400);
    }
    if (agenda) {
      validated.agendaHtml = agenda;
    } else if (!isPartial) {
      validated.agendaHtml = '';
    }
  }

  if (!isPartial || agendaPhotoRaw !== undefined || agendaPhotosRaw !== undefined) {
    let sources = [];

    if (Array.isArray(agendaPhotosRaw)) {
      sources = agendaPhotosRaw;
    } else if (Array.isArray(agendaPhotoRaw)) {
      sources = agendaPhotoRaw;
    } else if (agendaPhotoRaw === null || agendaPhotoRaw === undefined || agendaPhotoRaw === '') {
      sources = [];
    } else if (agendaPhotoRaw !== undefined) {
      sources = [agendaPhotoRaw];
    }

    const cleanedPhotos = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0)
      .map((value) =>
        ensureBase64ImageDataUrl({
          value,
          fieldLabel: 'Meeting agenda photo',
        })
      );

    validated.agendaPhotos = cleanedPhotos;
  }

  if (!isPartial || agendaAttachmentsRaw !== undefined) {
    if (agendaAttachmentsRaw == null) {
      validated.agendaAttachments = [];
    } else if (!Array.isArray(agendaAttachmentsRaw)) {
      throw createHttpError('agendaAttachments must be an array of base64 strings', 400);
    } else {
      const cleaned = agendaAttachmentsRaw
        .map((entry) => (entry == null ? '' : entry.toString().trim()))
        .filter((entry) => entry.length > 0);
      validated.agendaAttachments = cleaned;
    }
  }

  if (!isPartial || discussionHtmlRaw !== undefined) {
    const discussions =
      discussionHtmlRaw !== undefined && discussionHtmlRaw !== null
        ? discussionHtmlRaw.toString()
        : '';
    validated.discussionHtml = discussions;
  }

  if (!isPartial || discussionPhotoRaw !== undefined || discussionPhotosRaw !== undefined) {
    let sources = [];

    if (Array.isArray(discussionPhotosRaw)) {
      sources = discussionPhotosRaw;
    } else if (Array.isArray(discussionPhotoRaw)) {
      sources = discussionPhotoRaw;
    } else if (
      discussionPhotoRaw === null ||
      discussionPhotoRaw === undefined ||
      discussionPhotoRaw === ''
    ) {
      sources = [];
    } else if (discussionPhotoRaw !== undefined) {
      sources = [discussionPhotoRaw];
    }

    const cleanedPhotos = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0)
      .map((value) =>
        ensureBase64ImageDataUrl({
          value,
          fieldLabel: 'Meeting discussion photo',
        })
      );

    validated.discussionPhotos = cleanedPhotos;
  }

  if (!isPartial || discussionAttachmentsRaw !== undefined) {
    if (discussionAttachmentsRaw == null) {
      validated.discussionAttachments = [];
    } else if (!Array.isArray(discussionAttachmentsRaw)) {
      throw createHttpError('discussionAttachments must be an array of base64 strings', 400);
    } else {
      const cleaned = discussionAttachmentsRaw
        .map((entry) => (entry == null ? '' : entry.toString().trim()))
        .filter((entry) => entry.length > 0);
      validated.discussionAttachments = cleaned;
    }
  }

  return validated;
};

const buildMeetingResponse = (doc) => {
  const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
  const meetingDateLabel = meetingDateTime ? toISTDateLabel(meetingDateTime) : null;
  const meetingTimeLabel = meetingDateTime ? toISTTimeLabel(meetingDateTime) : null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(doc.updatedAt) : null;
  const createdOn = createdAt ? toISTDateTimeLabel(createdAt) : '';
  let updatedOn = '';
  if (createdAt && updatedAt && updatedAt.getTime() !== createdAt.getTime()) {
    updatedOn = toISTDateTimeLabel(updatedAt);
  }
  return {
    meetingId: doc.meetingId,
    societyId: String(doc.societyId),
    meetingDate: doc.meetingDate || meetingDateLabel,
    meetingStartingFrom: doc.meetingStartingFrom || meetingTimeLabel,
    venue: doc.venue,
    agendaHtml: doc.agendaHtml,
    agendaPhotos: Array.isArray(doc.agendaPhotos) ? doc.agendaPhotos : [],
    agendaAttachments: doc.agendaAttachments || [],
    discussionHtml: doc.discussionHtml || '',
    discussionPhotos: Array.isArray(doc.discussionPhotos) ? doc.discussionPhotos : [],
    discussionAttachments: doc.discussionAttachments || [],
    createdOn,
    updatedOn,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const createMeeting = async (req, res, next) => {
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
      validated = validateMeetingPayload(req.body || {}, { isPartial: false });
    } catch (e) {
      return next(e);
    }

    const doc = await Meeting.create({
      societyId: society._id,
      createdByUserId: authUser._id,
      meetingDate: validated.meetingDate,
      meetingStartingFrom: validated.meetingStartingFrom,
      venue: validated.venue,
      agendaHtml: validated.agendaHtml,
      agendaPhotos: validated.agendaPhotos || [],
      agendaAttachments: validated.agendaAttachments || [],
      discussionHtml: validated.discussionHtml || '',
      discussionPhotos: validated.discussionPhotos || [],
      discussionAttachments: validated.discussionAttachments || [],
    });

    return sendSuccessResponse(res, 201, 'Meeting created successfully', {
      data: buildMeetingResponse(doc),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create meeting'));
  }
};

const getMeetings = async (req, res, next) => {
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
        return next(createHttpError('unitId is required to view meetings', 400));
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

    const items = await Meeting.find({ societyId, deletedAt: null }).lean();

    const now = new Date();

    let lastMeetingsSeenAtTs = null;
    if (isMemberView) {
      const lastSeen =
        authUser.lastMeetingsSeenAt instanceof Date
          ? authUser.lastMeetingsSeenAt
          : authUser.lastMeetingsSeenAt
          ? new Date(authUser.lastMeetingsSeenAt)
          : null;
      lastMeetingsSeenAtTs = lastSeen ? lastSeen.getTime() : null;
    }

    const upcomingMeetings = [];
    const pastMeetings = [];

    items.forEach((doc) => {
      const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
      const target = meetingDateTime && meetingDateTime > now ? upcomingMeetings : pastMeetings;

      const createdAt =
        doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;

      let isRead = true;
      if (isMemberView) {
        if (lastMeetingsSeenAtTs && createdAt) {
          isRead = createdAt.getTime() <= lastMeetingsSeenAtTs;
        } else {
          isRead = true;
        }
      }

      const payload = buildMeetingResponse(doc);
      payload.isRead = isRead;

      target.push(payload);
    });

    return sendSuccessResponse(res, 200, 'Meetings fetched successfully', {
      data: {
        upcomingMeetings,
        pastMeetings,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch meetings'));
  }
};

const getMeetingById = async (req, res, next) => {
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
        return next(createHttpError('unitId is required to view meetings', 400));
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

    const meetingId = normalizeString(
      ((req.body || {}).meetingId) ||
        ((req.params && req.params.meetingId) || (req.query && req.query.meetingId) || '')
    );

    if (!meetingId) {
      return next(createHttpError('meetingId is required', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId,
      deletedAt: null,
    }).lean();

    if (!doc) {
      return next(createHttpError('Meeting not found', 404));
    }

    if (isMemberView) {
      const createdAt =
        doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;

      if (createdAt) {
        const lastSeenRaw = authUser.lastMeetingsSeenAt;
        const lastSeen =
          lastSeenRaw instanceof Date ? lastSeenRaw : lastSeenRaw ? new Date(lastSeenRaw) : null;
        const lastSeenTs = lastSeen ? lastSeen.getTime() : 0;
        const createdAtTs = createdAt.getTime();

        if (createdAtTs > lastSeenTs) {
          await User.findByIdAndUpdate(authUser._id, { lastMeetingsSeenAt: createdAt }).exec();
        }
      }
    }

    return sendSuccessResponse(res, 200, 'Meeting fetched successfully', {
      data: buildMeetingResponse(doc),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch meeting'));
  }
};

const updateMeetingById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const meetingId = normalizeString(
      ((req.body || {}).meetingId) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found', 404));
    }

    let validated;
    try {
      validated = validateMeetingPayload(req.body || {}, { isPartial: true });
    } catch (e) {
      return next(e);
    }

  const now = new Date();
  const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
  const isUpcoming = meetingDateTime && meetingDateTime > now;

    if (isUpcoming) {
      if (validated.meetingDate !== undefined) {
        doc.meetingDate = validated.meetingDate;
      }
      if (validated.meetingStartingFrom !== undefined) {
        doc.meetingStartingFrom = validated.meetingStartingFrom;
      }
      if (validated.venue !== undefined) {
        doc.venue = validated.venue;
      }
      if (validated.agendaHtml !== undefined) {
        doc.agendaHtml = validated.agendaHtml;
      }
      if (validated.agendaPhotos !== undefined) {
        doc.agendaPhotos = validated.agendaPhotos;
      }
      if (validated.agendaAttachments !== undefined) {
        doc.agendaAttachments = validated.agendaAttachments;
      }
      if (
        validated.discussionHtml !== undefined ||
        validated.discussionPhotos !== undefined ||
        validated.discussionAttachments !== undefined
      ) {
        return next(
          createHttpError(
            'You can add Discussions & Decisions only after the meeting has happened',
            400
          )
        );
      }
    } else {
      if (
        validated.meetingDate !== undefined ||
        validated.meetingStartingFrom !== undefined ||
        validated.venue !== undefined ||
        validated.agendaHtml !== undefined ||
        validated.agendaPhotos !== undefined ||
        validated.agendaAttachments !== undefined
      ) {
        return next(
          createHttpError(
            'You cannot edit meeting date, time, venue, or agenda for a meeting that has already happened',
            400
          )
        );
      }
    }

    if (validated.discussionHtml !== undefined) {
      doc.discussionHtml = validated.discussionHtml;
    }
    if (validated.discussionPhotos !== undefined) {
      doc.discussionPhotos = validated.discussionPhotos;
    }
    if (validated.discussionAttachments !== undefined) {
      doc.discussionAttachments = validated.discussionAttachments;
    }

    await doc.save();

    return sendSuccessResponse(res, 200, 'Meeting updated successfully', {
      data: buildMeetingResponse(doc),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update meeting'));
  }
};

const updateMeetingDiscussionById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const meetingId = normalizeString(
      ((req.body || {}).meetingId) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found', 404));
    }

    const now = new Date();
    const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
    if (!meetingDateTime || meetingDateTime > now) {
      return next(
        createHttpError(
          'You can add or edit Discussions & Decisions only after the meeting has happened',
          400
        )
      );
    }

    let validated;
    try {
      validated = validateMeetingPayload(req.body || {}, { isPartial: true });
    } catch (e) {
      return next(e);
    }

    if (validated.discussionHtml !== undefined) {
      doc.discussionHtml = validated.discussionHtml;
    }
    if (validated.discussionPhotos !== undefined) {
      doc.discussionPhotos = validated.discussionPhotos;
    }
    if (validated.discussionAttachments !== undefined) {
      doc.discussionAttachments = validated.discussionAttachments;
    }

    await doc.save();

    return sendSuccessResponse(res, 200, 'Meeting discussions updated successfully', {
      data: buildMeetingResponse(doc),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update meeting discussions'));
  }
};

const deleteMeetingById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const society = await resolveAdminSociety(authUser);

    const meetingId = normalizeString(
      ((req.body || {}).meetingId) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found', 404));
    }

    const deletedAt = new Date();
    doc.deletedAt = deletedAt;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Meeting deleted successfully', {
      data: {
        meetingId: doc.meetingId,
        deletedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete meeting'));
  }
};

module.exports = {
  createMeeting,
  getMeetings,
  getMeetingById,
  updateMeetingById,
  updateMeetingDiscussionById,
  deleteMeetingById,
};
