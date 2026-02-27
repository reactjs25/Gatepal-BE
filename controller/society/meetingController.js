const mongoose = require('mongoose');
const Meeting = require('../../model/meetingSchema');
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
const { toISTDateLabel, toISTTimeLabel, toISTDateTimeLabel } = require('../../utils/dateTime');
const { assertUnitResidentAccess } = require('../../utils/unitAccess');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { sendToSocietyMembers } = require('../../utils/pushNotificationService');
const { getNotificationMessage } = require('../../utils/notificationMessages');

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

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

const parseMeetingDateTime = (meetingDate, meetingStartingFrom) => {
  if (!meetingDate || !meetingStartingFrom) return null;
  const dateStr = meetingDate.toString().trim();
  const timeStr = meetingStartingFrom.toString().trim();
  if (!dateStr || !timeStr) return null;
  const combined = `${dateStr} ${timeStr}`;
  const d = new Date(combined);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError('meetingDate and meetingStartingFrom must form a valid date-time.', 400);
  }
  return d;
};

const validateMeetingPayload = async (payload = {}, options = {}) => {
  const isPartial = !!options.isPartial;
  const storagePrefix = normalizeString(options.storagePrefix) || 'meetings';

  const meetingDateRaw = getLastBodyValue(payload.meetingDate);
  const startingFromRaw = getLastBodyValue(payload.meetingStartingFrom);
  const venueRaw = getLastBodyValue(payload.venue);
  const agendaRaw = getLastBodyValue(payload.agendaHtml);
  const agendaPhotoRaw =
    payload.agendaPhoto !== undefined
      ? payload.agendaPhoto
      : payload.agendaImage !== undefined
        ? payload.agendaImage
        : payload.agendaImageUrl;
  const agendaPhotosRaw = payload.agendaPhotos !== undefined ? payload.agendaPhotos : payload.agendaImages;
  const agendaAttachmentsRaw = payload.agendaAttachments !== undefined ? payload.agendaAttachments : payload.agendaAttachment;
  const discussionHtmlRaw = getLastBodyValue(payload.discussionHtml);
  const discussionPhotoRaw =
    payload.discussionPhoto !== undefined
      ? payload.discussionPhoto
      : payload.discussionImage !== undefined
        ? payload.discussionImage
        : payload.discussionImageUrl;
  const discussionPhotosRaw = payload.discussionPhotos !== undefined ? payload.discussionPhotos : payload.discussionImages;
  const discussionAttachmentsRaw = payload.discussionAttachments !== undefined ? payload.discussionAttachments : payload.discussionAttachment;

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
          throw createHttpError('meetingDate and meetingStartingFrom are required.', 400);
        }
        throw createHttpError(
          'Both meetingDate and meetingStartingFrom are required when updating meeting time.',
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
      throw createHttpError('venue is required.', 400);
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
      throw createHttpError('agendaHtml is required.', 400);
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

    const cleanedPhotoInputs = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0);

    let cleanedPhotos = [];
    try {
      cleanedPhotos = await normalizeImageListToStorageUrls({
        values: cleanedPhotoInputs,
        fieldLabel: 'Meeting agenda photo',
        keyPrefix: `${storagePrefix}/agenda`,
        fileNamePrefix: 'agenda-photo',
      });
    } catch (e) {
      throw createHttpError(e.message, 400);
    }

    validated.agendaPhotos = cleanedPhotos;
  }

  if (!isPartial || agendaAttachmentsRaw !== undefined) {
    if (agendaAttachmentsRaw == null) {
      validated.agendaAttachments = [];
    } else {
      const attachmentItems = Array.isArray(agendaAttachmentsRaw)
        ? agendaAttachmentsRaw
        : [agendaAttachmentsRaw];
      const cleaned = attachmentItems
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

    const cleanedPhotoInputs = sources
      .map((entry) => (entry == null ? '' : entry.toString().trim()))
      .filter((entry) => entry.length > 0);

    let cleanedPhotos = [];
    try {
      cleanedPhotos = await normalizeImageListToStorageUrls({
        values: cleanedPhotoInputs,
        fieldLabel: 'Meeting discussion photo',
        keyPrefix: `${storagePrefix}/discussion`,
        fileNamePrefix: 'discussion-photo',
      });
    } catch (e) {
      throw createHttpError(e.message, 400);
    }

    validated.discussionPhotos = cleanedPhotos;
  }

  if (!isPartial || discussionAttachmentsRaw !== undefined) {
    if (discussionAttachmentsRaw == null) {
      validated.discussionAttachments = [];
    } else {
      const attachmentItems = Array.isArray(discussionAttachmentsRaw)
        ? discussionAttachmentsRaw
        : [discussionAttachmentsRaw];
      const cleaned = attachmentItems
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
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    let validated;
    try {
      validated = await validateMeetingPayload(req.body || {}, {
        isPartial: false,
        storagePrefix: `meetings/${String(society._id)}`,
      });
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

    // Send push notification to all society members
    const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
    const dateLabel = meetingDateTime ? toISTDateLabel(meetingDateTime) : doc.meetingDate;
    const timeLabel = meetingDateTime ? toISTTimeLabel(meetingDateTime) : doc.meetingStartingFrom;
    
    sendToSocietyMembers(
      society._id,
      'New Meeting Scheduled',
      `Meeting on ${dateLabel} at ${timeLabel}. Venue: ${validated.venue}`,
      {
        type: 'meeting',
        meetingId: doc.meetingId,
        societyId: String(society._id),
      },
      {
        roles: ['member', 'guard'],
        localizedContentResolver: ({ languageCode }) =>
          getNotificationMessage(
            'meeting_scheduled',
            {
              meetingDateLabel: dateLabel,
              meetingTimeLabel: timeLabel,
              venue: validated.venue,
            },
            languageCode
          ),
      }
    ).catch((err) => {
      console.error('[Meeting] Failed to send push notification:', err.message);
    });

    return sendSuccessResponse(res, 201, 'Meeting created successfully.', {
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
        return next(createHttpError('societyId is required for guards to view meetings.', 400));
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
        return next(createHttpError('unitId is required to view meetings.', 400));
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

    const items = await Meeting.find({ societyId, deletedAt: null }).lean();

    const now = new Date();
    const readMeetingIdsSet = (isMemberView || isGuardView)
      ? new Set(
          Array.isArray(authUser.readMeetingIds)
            ? authUser.readMeetingIds.map((id) => String(id))
            : []
        )
      : null;

    const upcomingMeetings = [];
    const pastMeetings = [];

    items.forEach((doc) => {
      const meetingDateTime = parseMeetingDateTime(doc.meetingDate, doc.meetingStartingFrom);
      const target = meetingDateTime && meetingDateTime > now ? upcomingMeetings : pastMeetings;

      const payload = buildMeetingResponse(doc);
      payload.isRead = (isMemberView || isGuardView) ? readMeetingIdsSet.has(String(doc.meetingId)) : true;

      target.push(payload);
    });

    return sendSuccessResponse(res, 200, 'Meetings fetched successfully.', {
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
        return next(createHttpError('societyId is required for guards to view meetings.', 400));
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
        return next(createHttpError('unitId is required to view meetings.', 400));
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

    const meetingId = normalizeString(
      getLastBodyValue(((req.body || {}).meetingId)) ||
        ((req.params && req.params.meetingId) || (req.query && req.query.meetingId) || '')
    );

    if (!meetingId) {
      return next(createHttpError('meetingId is required.', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId,
      deletedAt: null,
    }).lean();

    if (!doc) {
      return next(createHttpError('Meeting not found.', 404));
    }

    if (isMemberView || isGuardView) {
      await User.findByIdAndUpdate(authUser._id, {
        $addToSet: { readMeetingIds: String(doc.meetingId) },
      }).exec();
    }

    return sendSuccessResponse(res, 200, 'Meeting fetched successfully.', {
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
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    const meetingId = normalizeString(
      getLastBodyValue(((req.body || {}).meetingId)) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required.', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found.', 404));
    }

    let validated;
    try {
      validated = await validateMeetingPayload(req.body || {}, {
        isPartial: true,
        storagePrefix: `meetings/${String(society._id)}/${String(doc._id)}`,
      });
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

    return sendSuccessResponse(res, 200, 'Meeting updated successfully.', {
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
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    const meetingId = normalizeString(
      getLastBodyValue(((req.body || {}).meetingId)) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required.', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found.', 404));
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
      validated = await validateMeetingPayload(req.body || {}, {
        isPartial: true,
        storagePrefix: `meetings/${String(society._id)}/${String(doc._id)}`,
      });
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

    return sendSuccessResponse(res, 200, 'Meeting discussions updated successfully.', {
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
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can perform this action.', 403));
    }

    const society = await resolveAdminSociety(req, authUser);

    const meetingId = normalizeString(
      getLastBodyValue(((req.body || {}).meetingId)) ||
        ((req.params && req.params.meetingId) || '')
    );
    if (!meetingId) {
      return next(createHttpError('meetingId path parameter is required.', 400));
    }

    const doc = await Meeting.findOne({
      meetingId,
      societyId: society._id,
      deletedAt: null,
    });

    if (!doc) {
      return next(createHttpError('Meeting not found.', 404));
    }

    const deletedAt = new Date();
    doc.deletedAt = deletedAt;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Meeting deleted successfully.', {
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









