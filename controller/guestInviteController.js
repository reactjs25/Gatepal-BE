const QRCode = require('qrcode');
const GuestInvite = require('../model/guestInviteSchema');
const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const { randomUUID } = require('crypto');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { normalizeString } = require('../utils/strings');
const { decodeQrImageDataUrl } = require('../utils/qrDecoder');
const {
  normalizeCountryCode,
  normalizeDigits,
  isTenDigitPhone,
} = require('../utils/phoneNumber');
const { toISTDateLabel, toISTTimeLabel } = require('../utils/dateTime');

const requireGuardOnDuty = (authUser) => {
  const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
  const activeDuty = guardSocieties.find((s) => s.isOnDuty === true);
  if (!activeDuty) {
    throw createHttpError('You must be on duty to perform this action', 400);
  }
  return activeDuty;
};

const resolveUnitResidents = async ({ societyId, wingNameLower, unitNumberLower }) => {
  const unitDocs = await MemberUnit.find(
    {
      societyId,
      wingNameLower,
      unitNumberLower,
      $or: [
        { occupancyStatus: 'currently_residing' },
        { occupancyStatus: 'unit_rented', occupantType: { $in: ['tenant', 'tenant_family_member'] } },
      ],
    },
    { memberId: 1 }
  ).lean();

  const memberIds = unitDocs.map((u) => u.memberId).filter(Boolean);
  const unique = Array.from(new Set(memberIds.map((id) => String(id)))).map((id) => id);
  return unique;
};

const canCreateGuestInvites = (req) => {
  const user = req.appUser;
  if (!user) return false;
  // Standard member flow
  if (user.role === 'member') return true;
  // Society admin flow: the session effective role is society_admin, and the linked app user may or may not
  // have role=member depending on how the account was created/migrated.
  if (user.role === 'society_admin') return true;
  if (req.user?.effectiveRole === 'society_admin') return true;
  return false;
};

const getRecentGuests = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    // Keep consistent with invite creation: allow members and society admins.
    if (!canCreateGuestInvites(req)) {
      return next(createHttpError('Only members (including society admins) can view recent guests', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    const daysNumber = Number(req.body?.days);

    const limit = 20;
    const days = Number.isFinite(daysNumber) && daysNumber > 0 ? Math.min(daysNumber, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    if (!unitId) {
      return next(createHttpError('unitId is required', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const invites = await GuestInvite.find(
      {
        unitId: unitDoc._id,
        createdAt: { $gte: since },
        $or: [
          { 'entryLogs.0': { $exists: true } },
          { 'guests.hasArrived': true },
        ],
      },
      {
        type: 1,
        guests: 1,
        entryLogs: 1,
        createdAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const byKey = new Map();

    const upsert = (key, candidate) => {
      if (!key) return;
      const existing = byKey.get(key);
      if (!existing || new Date(candidate.lastVisitedAt).getTime() > new Date(existing.lastVisitedAt).getTime()) {
        byKey.set(key, candidate);
      }
    };

    for (const invite of invites) {
      // Quick / frequent: use per-guest arrival info
      if (invite.type === 'quick' || invite.type === 'frequent') {
        for (const g of invite.guests || []) {
          if (!g || !g.hasArrived || !g.arrivedAt) continue;
          const phoneDigits = g.phoneDigits || (g.phoneNumber ? normalizeDigits(g.phoneNumber) : null);
          const key = phoneDigits || `${(g.name || '').toLowerCase()}|${String(g.guestId || '')}`;
          upsert(key, {
            name: g.name || null,
            countryCode: g.countryCode || null,
            phoneNumber: g.phoneNumber || null,
            lastVisitedAt: g.arrivedAt,
            imageUrl: null,
            source: g.source || 'recent',
          });
        }
      }

      // Group / party: use entry logs (which can include phone/name via entryDetails)
      if (invite.type === 'group') {
        for (const log of invite.entryLogs || []) {
          if (!log) continue;
          const name = (log.guestName || '').toString().trim();
          const isPlaceholderName = name.toLowerCase() === 'group guest';
          const hasPhone = Boolean((log.guestPhoneDigits || log.guestPhoneNumber || '').toString().trim());
          if (isPlaceholderName && !hasPhone) {
            // Skip placeholder group scans where guard hasn't filled identity yet
            continue;
          }
          const phoneDigits = log.guestPhoneDigits || (log.guestPhoneNumber ? normalizeDigits(log.guestPhoneNumber) : null);
          const key = phoneDigits || `${(log.guestName || '').toLowerCase()}|${String(log.entryLogId || '')}`;
          upsert(key, {
            name: log.guestName || null,
            countryCode: log.guestCountryCode || (log.guestPhoneNumber ? '+91' : null),
            phoneNumber: log.guestPhoneNumber || null,
            lastVisitedAt: log.scannedAt || invite.createdAt,
            imageUrl: log.imageUrl || null,
            source: 'recent',
          });
        }
      }
    }

    const recentGuests = Array.from(byKey.values())
      .filter((g) => g.name || g.phoneNumber)
      .sort((a, b) => new Date(b.lastVisitedAt).getTime() - new Date(a.lastVisitedAt).getTime())
      .slice(0, limit);

    return sendSuccessResponse(res, 200, 'Recent guests fetched successfully', {
      data: {
        unit: {
          id: String(unitDoc._id),
          wingName: unitDoc.wingName,
          unitNumber: unitDoc.unitNumber,
        },
        guests: recentGuests,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch recent guests'));
  }
};

const normalizeOption = (value) =>
  (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const parseDateOnly = (value, fieldLabel) => {
  if (!value) {
    throw createHttpError(`${fieldLabel} is required`, 400);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError(`Invalid ${fieldLabel} format`, 400);
  }
  d.setHours(0, 0, 0, 0);
  return d;
};

const parseDateTime = (value, fieldLabel) => {
  if (!value) {
    throw createHttpError(`${fieldLabel} is required`, 400);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError(`Invalid ${fieldLabel} format`, 400);
  }
  return d;
};

const parseTimeOfDay = (value, fieldLabel) => {
  const raw = (value || '').toString().trim();
  if (!raw) {
    throw createHttpError(`${fieldLabel} is required`, 400);
  }

  const lower = raw.toLowerCase();

  const twelveHourMatch = lower.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/
  );
  if (twelveHourMatch) {
    let hour = parseInt(twelveHourMatch[1], 10);
    const minute = twelveHourMatch[2] ? parseInt(twelveHourMatch[2], 10) : 0;
    const meridiem = twelveHourMatch[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      throw createHttpError(`Invalid ${fieldLabel} value`, 400);
    }

    if (meridiem === 'pm' && hour !== 12) {
      hour += 12;
    } else if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }

    return { hour, minute };
  }

  const twentyFourMatch = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourMatch) {
    const hour = parseInt(twentyFourMatch[1], 10);
    const minute = parseInt(twentyFourMatch[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw createHttpError(`Invalid ${fieldLabel} value`, 400);
    }
    return { hour, minute };
  }

  throw createHttpError(`Invalid ${fieldLabel} format`, 400);
};

const sanitizeGuests = (guests) => {
  if (!Array.isArray(guests) || guests.length === 0) {
    throw createHttpError('At least one guest is required', 400);
  }

  const cleaned = [];

  for (const raw of guests) {
    const name = normalizeString(raw.name);
    const phoneNumberRaw = normalizeString(raw.phoneNumber);
    const countryCodeRaw = normalizeString(raw.countryCode);
    const sourceRaw = normalizeString(raw.source);

    if (!name) {
      throw createHttpError('Guest name is required', 400);
    }

    let phoneNumber = null;
    let phoneDigits = null;
    let countryCode = null;

    if (phoneNumberRaw) {
      if (!isTenDigitPhone(phoneNumberRaw)) {
        throw createHttpError('Guest phoneNumber must contain exactly 10 digits', 400);
      }
      phoneDigits = normalizeDigits(phoneNumberRaw);
      phoneNumber = phoneDigits;
      countryCode = normalizeCountryCode(countryCodeRaw || '+91');
    }

    const source = sourceRaw || 'manual';

    cleaned.push({
      guestId: require('crypto').randomUUID(),
      name,
      countryCode: countryCode || '+91',
      phoneNumber,
      phoneDigits,
      source,
      qrCodeImage: null,
      qrCodeGeneratedAt: null,
      hasArrived: false,
      arrivedAt: null,
    });
  }

  return cleaned;
};

const computeValidityWindow = ({ validFrom, validTill, validityHours }) => {
  const start = parseDateTime(validFrom, 'validFrom');

  let end = null;

  if (validTill) {
    end = parseDateTime(validTill, 'validTill');
  } else {
    const hours = Number(validityHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw createHttpError('validityHours must be a positive number', 400);
    }
    if (hours > 24) {
      throw createHttpError('validityHours cannot exceed 24 hours for quick invites', 400);
    }
    end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  }

  if (end <= start) {
    throw createHttpError('validTill must be after validFrom', 400);
  }

  return { validFrom: start, validTill: end };
};

const computeUiBasedValidityWindow = ({
  dateOption,
  selectedDate,
  validityType,
  validityHours,
  untilTimeOption,
}) => {
  const now = new Date();
  const normalizedDateOption = normalizeOption(dateOption || 'today');
  const normalizedValidityType = normalizeOption(validityType || 'hours');
  const normalizedUntil = normalizeOption(untilTimeOption || '');

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let baseDate = new Date(today);

  if (normalizedDateOption === 'tomorrow') {
    baseDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  } else if (
    normalizedDateOption === 'select_date' ||
    normalizedDateOption === 'selectdate' ||
    normalizedDateOption === 'custom'
  ) {
    if (!selectedDate) {
      throw createHttpError('selectedDate is required when dateOption is selectDate', 400);
    }
    const parsed = new Date(selectedDate);
    if (Number.isNaN(parsed.getTime())) {
      throw createHttpError('Invalid selectedDate format', 400);
    }
    baseDate = new Date(parsed);
    baseDate.setHours(0, 0, 0, 0);
  }

  if (normalizedValidityType === 'until_time') {
    const mapUntilToHour = (token) => {
      const t = normalizeOption(token);
      if (!t || t === 'all_day' || t === 'allday') return null;
      if (t.includes('9_am')) return 9;
      if (t.includes('12_pm')) return 12;
      if (t.includes('3_pm')) return 15;
      if (t.includes('6_pm')) return 18;
      if (t.includes('9_pm')) return 21;
      if (t === '9am') return 9;
      if (t === '12pm') return 12;
      if (t === '3pm') return 15;
      if (t === '6pm') return 18;
      if (t === '9pm') return 21;
      return null;
    };

    const hour = mapUntilToHour(normalizedUntil);
    const start = new Date(baseDate);
    let end;

    if (hour == null) {
      end = new Date(baseDate);
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date(baseDate);
      end.setHours(hour, 0, 0, 0);
    }

    if (end <= start) {
      throw createHttpError('Computed validity end time must be after start time', 400);
    }

    return { validFrom: start, validTill: end };
  }

  let start;
  if (
    normalizedDateOption === 'today' ||
    normalizedDateOption === 'none' ||
    !normalizedDateOption
  ) {
    start = now;
  } else {
    start = new Date(baseDate);
    start.setHours(9, 0, 0, 0);
  }

  return computeValidityWindow({
    validFrom: start.toISOString(),
    validTill: null,
    validityHours,
  });
};

const computeGroupInviteValidityWindow = ({
  selectedDate,
  startingFrom,
  validityHours,
}) => {
  const baseDate = parseDateOnly(selectedDate, 'selectedDate');
  const timeOfDay = parseTimeOfDay(startingFrom, 'startingFrom');

  const start = new Date(baseDate);
  start.setHours(timeOfDay.hour, timeOfDay.minute, 0, 0);

  const hours = Number(validityHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw createHttpError('validityHours must be a positive number', 400);
  }
  if (hours > 24) {
    throw createHttpError('validityHours cannot exceed 24 hours for group invites', 400);
  }

  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);

  if (end <= start) {
    throw createHttpError('Computed validity end time must be after start time', 400);
  }

  return { validFrom: start, validTill: end };
};

const computeFrequentInviteValidityWindow = ({
  allowEntryFor,
  startDate,
  endDate,
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const normalized = normalizeOption(allowEntryFor || '1_week');

  if (
    normalized === '1_week' ||
    normalized === 'one_week' ||
    normalized === 'week'
  ) {
    const start = new Date(today);
    const end = new Date(today);
    end.setDate(end.getDate() + 7 - 1);
    end.setHours(23, 59, 59, 999);
    return { validFrom: start, validTill: end };
  }

  if (
    normalized === '1_month' ||
    normalized === 'one_month' ||
    normalized === 'month'
  ) {
    const start = new Date(today);
    const end = new Date(today);
    end.setMonth(end.getMonth() + 1);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { validFrom: start, validTill: end };
  }

  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  end.setHours(23, 59, 59, 999);

  if (end < start) {
    throw createHttpError('endDate must be on or after startDate', 400);
  }

  return { validFrom: start, validTill: end };
};

const buildGuestInviteQrPayload = ({ invite, unit, member, guest }) => {
  const payload = {
    type: 'gatepal_guest_invite',
    version: 2,
    inviteId: invite.inviteId,
  };
  if (guest && guest.guestId) {
    payload.guestId = guest.guestId;
  }
  return JSON.stringify(payload);
};

const generateGuestQrCodes = async ({ invite, unit, member }) => {
  const updatedGuests = [];
  for (const guest of invite.guests) {
    try {
      const payload = buildGuestInviteQrPayload({ invite, unit, member, guest });
      const qrCodeImage = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      });
      updatedGuests.push({
        ...guest.toObject ? guest.toObject() : guest,
        qrCodeImage,
        qrCodeGeneratedAt: new Date(),
      });
    } catch (e) {
      updatedGuests.push({
        ...guest.toObject ? guest.toObject() : guest,
        qrCodeImage: null,
        qrCodeGeneratedAt: null,
      });
    }
  }
  return updatedGuests;
};

const createGroupInvite = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (!canCreateGuestInvites(req)) {
      return next(createHttpError('Only members (including society admins) can create guest invites', 403));
    }

    const { unitId, selectedDate, startingFrom, validityHours, guestCount } = req.body || {};

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    let window;
    try {
      window = computeGroupInviteValidityWindow({
        selectedDate,
        startingFrom,
        validityHours,
      });
    } catch (e) {
      return next(e);
    }

    const countNumber = Number(guestCount);
    if (!Number.isFinite(countNumber) || countNumber <= 0) {
      return next(createHttpError('guestCount must be a positive number', 400));
    }

    let placeholderGuests;
    try {
      placeholderGuests = sanitizeGuests([{ name: 'Group / Party Guests' }]);
    } catch (e) {
      return next(e);
    }

    const invite = await GuestInvite.create({
      type: 'group',
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
      invitedByUserId: authUser._id,
      isPrivateInvite: false,
      guests: placeholderGuests,
      validFrom: window.validFrom,
      validTill: window.validTill,
      maxEntries: countNumber,
    });

    const member = await User.findById(authUser._id).lean();

    let qrCodeImage = null;
    try {
      const payload = buildGuestInviteQrPayload({ invite, unit: unitDoc, member });
      qrCodeImage = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      });
    } catch (e) {
      qrCodeImage = null;
    }

    if (qrCodeImage) {
      invite.qrCodeImage = qrCodeImage;
      invite.qrCodeGeneratedAt = new Date();
      await invite.save();
    }

    const dateLabel = toISTDateLabel(window.validFrom);
    const fromTimeLabel = toISTTimeLabel(window.validFrom);
    const tillTimeLabel = toISTTimeLabel(window.validTill);
    const validityLabel = `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`;

    const responseData = {
      inviteId: invite.inviteId,
      type: invite.type,
      societyId: String(invite.societyId),
      unitId: String(invite.unitId),
      unit: {
        id: String(unitDoc._id),
        wingName: unitDoc.wingName,
        unitNumber: unitDoc.unitNumber,
      },
      invitedBy: {
        id: String(authUser._id),
        name: authUser.fullName || null,
      },
      isPrivateInvite: invite.isPrivateInvite,
      guests: invite.guests.map((g) => ({
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel,
      qrCodeImage: invite.qrCodeImage || null,
      maxEntries: invite.maxEntries,
    };

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate.`;

    return sendSuccessResponse(res, 201, 'Group guest invite created successfully', {
      data: responseData,
      shareMessage,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create group guest invite'));
  }
};

const createFrequentInvite = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (!canCreateGuestInvites(req)) {
      return next(createHttpError('Only members (including society admins) can create guest invites', 403));
    }

    const {
      unitId,
      allowEntryFor,
      startDate,
      endDate,
      guests,
    } = req.body || {};

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    let window;
    try {
      window = computeFrequentInviteValidityWindow({
        allowEntryFor,
        startDate,
        endDate,
      });
    } catch (e) {
      return next(e);
    }

    let cleanedGuests;
    try {
      cleanedGuests = sanitizeGuests(guests);
    } catch (e) {
      return next(e);
    }

    const invite = await GuestInvite.create({
      type: 'frequent',
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
      invitedByUserId: authUser._id,
      isPrivateInvite: false,
      guests: cleanedGuests,
      validFrom: window.validFrom,
      validTill: window.validTill,
      maxEntries: Number.MAX_SAFE_INTEGER,
    });

    const member = await User.findById(authUser._id).lean();

    // Generate individual QR codes for each guest
    const updatedGuests = await generateGuestQrCodes({ invite, unit: unitDoc, member });
    invite.guests = updatedGuests;
    await invite.save();

    const dateLabelFrom = toISTDateLabel(window.validFrom);
    const dateLabelTill = toISTDateLabel(window.validTill);
    const fromTimeLabel = toISTTimeLabel(window.validFrom);
    const tillTimeLabel = toISTTimeLabel(window.validTill);
    const validityLabel = `${dateLabelFrom} ${fromTimeLabel} to ${dateLabelTill} ${tillTimeLabel}`;

    const responseData = {
      inviteId: invite.inviteId,
      type: invite.type,
      societyId: String(invite.societyId),
      unitId: String(invite.unitId),
      unit: {
        id: String(unitDoc._id),
        wingName: unitDoc.wingName,
        unitNumber: unitDoc.unitNumber,
      },
      invitedBy: {
        id: String(authUser._id),
        name: authUser.fullName || null,
      },
      isPrivateInvite: invite.isPrivateInvite,
      guests: invite.guests.map((g) => ({
        guestId: g.guestId,
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
        qrCodeImage: g.qrCodeImage || null,
        hasArrived: g.hasArrived || false,
        arrivedAt: g.arrivedAt || null,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel,
      maxEntries: null,
    };

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate.`;

    return sendSuccessResponse(res, 201, 'Frequent guest invite created successfully', {
      data: responseData,
      shareMessage,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create frequent guest invite'));
  }
};

const createQuickInvite = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (!canCreateGuestInvites(req)) {
      return next(createHttpError('Only members (including society admins) can create guest invites', 403));
    }

    const {
      unitId,
      validFrom,
      validTill,
      validityHours,
      dateOption,
      selectedDate,
      validityType,
      untilTimeOption,
      isPrivateInvite,
      guests,
    } = req.body || {};

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    let window;
    try {
      if (validFrom || validTill) {
        window = computeValidityWindow({ validFrom, validTill, validityHours });
      } else {
        window = computeUiBasedValidityWindow({
          dateOption,
          selectedDate,
          validityType,
          validityHours,
          untilTimeOption,
        });
      }
    } catch (e) {
      return next(e);
    }

    let cleanedGuests;
    try {
      cleanedGuests = sanitizeGuests(guests);
    } catch (e) {
      return next(e);
    }

    const invite = await GuestInvite.create({
      type: 'quick',
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
      invitedByUserId: authUser._id,
      isPrivateInvite: Boolean(isPrivateInvite),
      guests: cleanedGuests,
      validFrom: window.validFrom,
      validTill: window.validTill,
      maxEntries: cleanedGuests.length,
    });

    const member = await User.findById(authUser._id).lean();

    // Generate individual QR codes for each guest
    const updatedGuests = await generateGuestQrCodes({ invite, unit: unitDoc, member });
    invite.guests = updatedGuests;
    await invite.save();

    const dateLabel = toISTDateLabel(window.validFrom);
    const fromTimeLabel = toISTTimeLabel(window.validFrom);
    const tillTimeLabel = toISTTimeLabel(window.validTill);
    const validityLabel = `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`;

    const responseData = {
      inviteId: invite.inviteId,
      type: invite.type,
      societyId: String(invite.societyId),
      unitId: String(invite.unitId),
      unit: {
        id: String(unitDoc._id),
        wingName: unitDoc.wingName,
        unitNumber: unitDoc.unitNumber,
      },
      invitedBy: {
        id: String(authUser._id),
        name: authUser.fullName || null,
      },
      isPrivateInvite: invite.isPrivateInvite,
      guests: invite.guests.map((g) => ({
        guestId: g.guestId,
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
        qrCodeImage: g.qrCodeImage || null,
        hasArrived: g.hasArrived || false,
        arrivedAt: g.arrivedAt || null,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel,
      maxEntries: invite.maxEntries,
    };

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate.`;

    return sendSuccessResponse(res, 201, 'Guest quick invite created successfully', {
      data: responseData,
      shareMessage,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create guest invite'));
  }
};

const scanGuestInvite = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'guard') {
      return next(createHttpError('Only guards can scan guest invites', 403));
    }

    // Scan only validates QR and returns visitor/invite details.
    // Entry-related details (vehicleNumber, accompanyingCount, imageUrl, units) are submitted via /api/guard/entryDetails.
    const { qrData, qrCodeImage, qrCodeImageUrl, qrImage, vehicleNumber, accompanyingCount } =
      req.body || {};

    let activeDuty;
    try {
      activeDuty = requireGuardOnDuty(authUser);
    } catch (e) {
      return next(e);
    }

    let payload;
    try {
      let text = normalizeString(qrData);
      const imageCandidate = qrCodeImage || qrCodeImageUrl || qrImage;
      const looksLikeImageDataUrl = !!(text && /^data:image\/[a-z0-9.+-]+;base64,/i.test(text));
      if (!text || looksLikeImageDataUrl) {
        const imageSource = looksLikeImageDataUrl ? text : imageCandidate;
        if (!imageSource) {
          return next(createHttpError('qrData or qrCodeImage is required', 400));
        }
        try {
          text = normalizeString(await decodeQrImageDataUrl(imageSource));
        } catch (e) {
          return next(createHttpError(e.message, 400));
        }
        if (!text) {
          return next(createHttpError('Unable to decode QR code image', 400));
        }
      }
      if (!text) {
        return next(createHttpError('qrData or qrCodeImage is required', 400));
      }
      payload = JSON.parse(text);
    } catch (e) {
      return next(createHttpError('Invalid QR data', 400));
    }

    // Delivery Executive (already onboarded visitors) flow
    if (payload.type === 'gatepal_visitor' && payload.userId) {
      const visitor = await User.findById(payload.userId).lean();
      if (!visitor) return next(createHttpError('Visitor not found', 404));
      if (visitor.role !== 'visitor') return next(createHttpError('QR code is not a valid visitor', 400));
      if (visitor.status && visitor.status !== 'active') {
        return next(createHttpError('Visitor is not active', 403));
      }

      const normalizedVisitorType = (visitor.visitorType || '').toString().trim().toLowerCase();

      if (normalizedVisitorType === 'delivery_executive') {
        return sendSuccessResponse(res, 200, 'Delivery executive validated successfully', {
          data: {
            scanType: 'delivery_executive',
            visitorUserId: String(visitor._id),
            name: visitor.fullName || null,
            phone: {
              countryCode: visitor.countryCode || '+91',
              phoneNumber: visitor.phoneNumber || null,
            },
            companyName: visitor.visitorCompanyName || null,
            imageUrl: visitor.profilePhoto || null,
            message: 'QR validated successfully.Click a picture to continue.',
          },
        });
      }

      if (normalizedVisitorType === 'taxi_vehicle_driver') {
        return sendSuccessResponse(res, 200, 'Taxi vehicle driver validated successfully', {
          data: {
            scanType: 'taxi_vehicle_driver',
            visitorUserId: String(visitor._id),
            name: visitor.fullName || null,
            phone: {
              countryCode: visitor.countryCode || '+91',
              phoneNumber: visitor.phoneNumber || null,
            },
            companyName: visitor.visitorCompanyName || null,
            vehicleNumber: visitor.visitorVehicleNumber || null,
            imageUrl: visitor.profilePhoto || null,
            message: 'QR validated successfully.Click a picture to continue.',
          },
        });
      }

      if (normalizedVisitorType === 'other_visitor') {
        return sendSuccessResponse(res, 200, 'Other visitor validated successfully', {
          data: {
            scanType: 'other_visitor',
            visitorUserId: String(visitor._id),
            name: visitor.fullName || null,
            phone: {
              countryCode: visitor.countryCode || '+91',
              phoneNumber: visitor.phoneNumber || null,
            },
            companyName: visitor.visitorCompanyName || null,
            vehicleNumber: visitor.visitorVehicleNumber || null,
            workCategory: visitor.visitorWorkCategory || null,
            imageUrl: visitor.profilePhoto || null,
            message: 'QR validated successfully.Click a picture to continue.',
          },
        });
      }

      return next(createHttpError('QR code is not a supported visitor type', 400));
    }

    if (payload.type !== 'gatepal_guest_invite' || !payload.inviteId) {
      return next(createHttpError('QR code is not a valid guest invite', 400));
    }

    const invite = await GuestInvite.findOne({ inviteId: payload.inviteId });

    if (!invite) {
      return next(createHttpError('Guest invite not found or expired', 404));
    }

    if (String(invite.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Invite does not belong to this society', 403));
    }

    const now = new Date();

    if (invite.status !== 'active') {
      return next(createHttpError('Invite is no longer active', 400));
    }

    if (now < invite.validFrom) {
      return next(createHttpError('Invite is not yet valid', 400));
    }

    if (now > invite.validTill) {
      invite.status = 'expired';
      await invite.save();
      return next(createHttpError('Invite has expired', 400));
    }

    // Find the specific guest from the QR code (for quick/frequent invites with per-guest QR)
    const guestId = payload.guestId;
    let arrivingGuest = null;
    let arrivingGuestIndex = -1;

    if (guestId) {
      arrivingGuestIndex = invite.guests.findIndex((g) => g.guestId === guestId);
      if (arrivingGuestIndex === -1) {
        return next(createHttpError('Guest not found in this invite', 404));
      }
      arrivingGuest = invite.guests[arrivingGuestIndex];

      // For quick invites, check if this specific guest has already arrived
      if (invite.type === 'quick' && arrivingGuest.hasArrived) {
        return next(createHttpError(`${arrivingGuest.name} has already used this invite`, 400));
      }
    }

    // For group invites without guestId, use the old logic
    const usedEntries = Array.isArray(invite.entryLogs) ? invite.entryLogs.length : 0;
    const hasEntryLimit = invite.type === 'group';
    if (hasEntryLimit && usedEntries >= invite.maxEntries) {
      return next(createHttpError('Entry limit reached for this invite', 400));
    }

    // Scan step should work with only qrData. Vehicle/accompanyingCount are optional here
    // and can be updated later via /api/guard/entryDetails.
    const normalizedVehicleNumber = normalizeString(vehicleNumber).toUpperCase() || null;
    const countNumber = Number(accompanyingCount);
    const safeCount = Number.isFinite(countNumber) && countNumber > 0 ? countNumber : 0;

    // Add entry log with guest information
    const entryLogId = randomUUID();
    invite.entryLogs.push({
      entryLogId,
      guestId: guestId || 'group',
      guestName: arrivingGuest ? arrivingGuest.name : 'Group Guest',
      scannedAt: now,
      guardId: authUser._id,
      gateId: activeDuty.dutyGateId || null,
      gateName: activeDuty.dutyGateName || null,
      vehicleNumber: normalizedVehicleNumber,
      accompanyingCount: safeCount,
      imageUrl: null,
      imageCapturedAt: null,
    });

    // Mark the specific guest as arrived (for quick/frequent invites)
    if (arrivingGuestIndex !== -1) {
      invite.guests[arrivingGuestIndex].hasArrived = true;
      invite.guests[arrivingGuestIndex].arrivedAt = now;
    }

    await invite.save();

    const member = await User.findById(invite.invitedByUserId).lean();
    const unit = await MemberUnit.findById(invite.unitId).lean();

    const dateLabel = toISTDateLabel(invite.validFrom);
    const fromTimeLabel = toISTTimeLabel(invite.validFrom);
    const tillTimeLabel = toISTTimeLabel(invite.validTill);

    const usedEntriesAfterScan = usedEntries + 1;

    // Calculate remaining entries based on invite type
    let remainingEntries = null;
    if (invite.type === 'quick') {
      // For quick invites, remaining = guests who haven't arrived
      remainingEntries = invite.guests.filter((g) => !g.hasArrived).length;
    } else if (invite.type === 'group') {
      remainingEntries = Math.max(invite.maxEntries - usedEntriesAfterScan, 0);
    }
    // For frequent invites, remainingEntries stays null (unlimited)

    const responseData = {
      inviteId: invite.inviteId,
      inviteType: invite.type,
      societyId: String(invite.societyId),
      unitId: String(invite.unitId),
      entryLogId,
      unit: unit
        ? {
          wingName: unit.wingName,
          unitNumber: unit.unitNumber,
        }
        : null,
      invitedBy: member
        ? {
          id: String(member._id),
          name: member.fullName || null,
          countryCode: member.countryCode || '+91',
          phoneNumber: member.phoneNumber || null,
        }
        : null,
      arrivingGuest: arrivingGuest
        ? {
          guestId: arrivingGuest.guestId,
          name: arrivingGuest.name,
          countryCode: arrivingGuest.countryCode,
          phoneNumber: arrivingGuest.phoneNumber,
          arrivedAt: now,
        }
        : null,
      guests: invite.guests.map((g) => ({
        guestId: g.guestId,
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
        hasArrived: g.hasArrived || false,
        arrivedAt: g.arrivedAt || null,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel: `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`,
      maxEntries: invite.type === 'frequent' ? null : invite.maxEntries,
      usedEntries: usedEntriesAfterScan,
      remainingEntries,
      message: arrivingGuest
        ? `${arrivingGuest.name} verified successfully. Click a picture to continue.`
        : 'QR validated successfully. Click a picture to continue.',
    };

    return sendSuccessResponse(res, 200, 'Guest invite validated successfully', {
      data: responseData,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to validate guest invite'));
  }
};

const updateGuestInviteEntryDetails = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'guard') {
      return next(createHttpError('Only guards can update guest invite entry details', 403));
    }

    const {
      inviteId,
      entryLogId,
      vehicleNumber,
      accompanyingCount,
      imageUrl,
      fullName,
      phoneNumber,
      countryCode,
      visitorUserId,
      unitNumber,
      unitNumbers,
      wing,
      wingName,
    } = req.body || {};

    let activeDuty;
    try {
      activeDuty = requireGuardOnDuty(authUser);
    } catch (e) {
      return next(e);
    }

    // Delivery Executive entry details submission (creates approval requests to multiple units)
    const normalizedVisitorUserId = normalizeString(visitorUserId);
    const normalizedInviteId = normalizeString(inviteId);
    const normalizedEntryLogId = normalizeString(entryLogId);

    if (!normalizedInviteId && !normalizedEntryLogId && normalizedVisitorUserId) {
      const v = await User.findById(normalizedVisitorUserId).lean();
      if (!v) return next(createHttpError('Visitor not found', 404));
      if (v.role !== 'visitor') return next(createHttpError('visitorUserId is invalid', 400));
      if ((v.visitorType || '').toLowerCase() !== 'delivery_executive') {
        return next(createHttpError('Visitor is not a delivery executive', 400));
      }

      const normalizedWingName = normalizeString(wingName ?? wing);
      if (!normalizedWingName) return next(createHttpError('wing is required', 400));

      const requestedUnitsRaw =
        Array.isArray(unitNumbers) && unitNumbers.length > 0
          ? unitNumbers
          : unitNumber
            ? [unitNumber]
            : [];

      const requestedUnits = requestedUnitsRaw.map((u) => normalizeString(u)).filter(Boolean);
      if (requestedUnits.length === 0) return next(createHttpError('unitNumber(s) is required', 400));

      // Photo rule:
      // - If visitor already has onboarded photo, imageUrl is optional (we can reuse it)
      // - If visitor has no onboarded photo, imageUrl is mandatory (guard must capture)
      const onboardedPhoto = normalizeString(v.profilePhoto) || null;
      const providedPhoto = normalizeString(imageUrl) || null;
      const finalImageUrl = providedPhoto || onboardedPhoto || null;
      if (!finalImageUrl) {
        return next(createHttpError('imageUrl is required', 400));
      }

      const vehicle = normalizeString(vehicleNumber).toUpperCase() || (v.visitorVehicleNumber || '').toString().trim().toUpperCase() || null;
      const countNumber = Number(accompanyingCount);
      const safeCount = Number.isFinite(countNumber) && countNumber > 0 ? countNumber : 0;

      const phoneRaw = normalizeString(v.phoneNumber);
      if (!phoneRaw || !isTenDigitPhone(phoneRaw)) {
        return next(createHttpError('Visitor phone number is invalid', 400));
      }
      const phoneDigits = normalizeDigits(phoneRaw);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      const created = [];
      for (const unitNo of requestedUnits) {
        const recipientUserIds = await resolveUnitResidents({
          societyId: activeDuty.societyId,
          wingNameLower: normalizedWingName.toLowerCase(),
          unitNumberLower: unitNo.toLowerCase(),
        });

        if (!recipientUserIds || recipientUserIds.length === 0) {
          created.push({
            requestId: null,
            unit: { wingName: normalizedWingName, unitNumber: unitNo },
            status: 'No residents found',
            statusKey: 'invalid_unit',
          });
          continue;
        }

        const doc = await GuestEntryRequest.create({
          societyId: activeDuty.societyId,
          wingName: normalizedWingName,
          wingNameLower: normalizedWingName.toLowerCase(),
          unitNumber: unitNo,
          unitNumberLower: unitNo.toLowerCase(),
          createdByGuardId: authUser._id,
          gateId: activeDuty.dutyGateId || null,
          gateName: activeDuty.dutyGateName || null,
          guestName: v.fullName || 'Delivery Executive',
          guestCountryCode: normalizeCountryCode(v.countryCode || '+91'),
          guestPhoneNumber: phoneDigits,
          guestPhoneDigits: phoneDigits,
          guestImageUrl: finalImageUrl,
          accompanyingCount: safeCount,
          vehicleNumber: vehicle,
          status: 'pending',
          expiresAt,
          recipientUserIds,
          visitorType: 'delivery_executive',
          visitorUserId: v._id,
          visitorCompanyName: v.visitorCompanyName || null,
        });

        created.push({
          requestId: doc.requestId,
          unit: { wingName: doc.wingName, unitNumber: doc.unitNumber },
          status: 'Awaiting Approval',
          statusKey: doc.status,
        });
      }

      const validCreated = created.filter((x) => x.requestId);
      const overallStatus =
        validCreated.length === 0 ? 'Rejected' : 'Awaiting Approval';

      return sendSuccessResponse(res, 201, 'Delivery entry requests created successfully', {
        data: {
          category: 'Delivery',
          visitorType: 'Delivery Executive',
          status: overallStatus,
          expiresAt,
          visitor: {
            id: String(v._id),
            name: v.fullName || null,
            companyName: v.visitorCompanyName || null,
            // Single, consistent image field for UI
            imageUrl: finalImageUrl,
            phone: {
              countryCode: v.countryCode || '+91',
              phoneNumber: v.phoneNumber || null,
            },
          },
          entry: {
            vehicleNumber: vehicle,
            accompanyingCount: safeCount,
          },
          requests: created,
        },
      });
    }

    if (!normalizedInviteId) {
      return next(createHttpError('inviteId is required', 400));
    }
    if (!normalizedEntryLogId) {
      return next(createHttpError('entryLogId is required', 400));
    }

    const invite = await GuestInvite.findOne({ inviteId: normalizedInviteId });
    if (!invite) {
      return next(createHttpError('Guest invite not found', 404));
    }

    if (String(invite.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Invite does not belong to this society', 403));
    }

    const idx = (invite.entryLogs || []).findIndex((l) => l.entryLogId === normalizedEntryLogId);
    if (idx === -1) {
      return next(createHttpError('Entry log not found for this invite', 404));
    }


    if (String(invite.entryLogs[idx].guardId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: only the scanning guard can update these details', 403));
    }


    if (invite.type === 'group') {
      const existingLog = invite.entryLogs[idx] || {};
      const existingName = normalizeString(existingLog.guestName);
      const existingPhone = normalizeString(existingLog.guestPhoneNumber);
      const isPlaceholderName = !existingName || existingName.toLowerCase() === 'group guest';
      const needsIdentity = isPlaceholderName || !existingPhone;

      if (needsIdentity) {
        const normalizedName = normalizeString(fullName);
        const normalizedPhone = normalizeString(phoneNumber);
        if (!normalizedName) {
          return next(createHttpError('fullName is required for group invites', 400));
        }
        if (!normalizedPhone) {
          return next(createHttpError('phoneNumber is required for group invites', 400));
        }
        if (!isTenDigitPhone(normalizedPhone)) {
          return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
        }
      }
    }

    const updates = {};

    if (vehicleNumber !== undefined) {
      updates.vehicleNumber = normalizeString(vehicleNumber).toUpperCase() || null;
    }

    if (accompanyingCount !== undefined) {
      const countNumber = Number(accompanyingCount);
      updates.accompanyingCount = Number.isFinite(countNumber) && countNumber > 0 ? countNumber : 0;
    }

    if (imageUrl !== undefined) {
      const img = normalizeString(imageUrl);
      updates.imageUrl = img || null;
      updates.imageCapturedAt = img ? new Date() : null;
    }

    if (fullName !== undefined) {
      const name = normalizeString(fullName);
      updates.guestName = name || null;
    }

    if (phoneNumber !== undefined) {
      const raw = normalizeString(phoneNumber);
      if (raw) {
        if (!isTenDigitPhone(raw)) {
          return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
        }
        const digits = normalizeDigits(raw);
        updates.guestPhoneDigits = digits;
        updates.guestPhoneNumber = digits;
        updates.guestCountryCode = normalizeCountryCode(countryCode || '+91');
      } else {
        updates.guestPhoneDigits = null;
        updates.guestPhoneNumber = null;
        updates.guestCountryCode = normalizeCountryCode(countryCode || '+91');
      }
    } else if (countryCode !== undefined) {
      updates.guestCountryCode = normalizeCountryCode(countryCode || '+91');
    }

    if (Object.keys(updates).length === 0) {
      return sendSuccessResponse(res, 200, 'No changes provided', {
        data: {
          inviteId: invite.inviteId,
          entryLogId: invite.entryLogs[idx].entryLogId,
        },
      });
    }

    Object.assign(invite.entryLogs[idx], updates);
    await invite.save();

    const updated = invite.entryLogs[idx];


    const unit = await MemberUnit.findById(invite.unitId).lean();
    const guest =
      updated.guestId && updated.guestId !== 'group'
        ? (invite.guests || []).find((g) => g.guestId === updated.guestId) || null
        : null;

    return sendSuccessResponse(res, 200, 'Guest invite entry details updated successfully', {
      data: {
        status: 'Approved',
        category: 'Guest',
        inviteId: invite.inviteId,
        entryLogId: updated.entryLogId,
        guestId: updated.guestId,
        guestName: updated.guestName,
        guest: {
          name: updated.guestName || null,
          countryCode: updated.guestCountryCode || guest?.countryCode || null,
          phoneNumber: updated.guestPhoneNumber || guest?.phoneNumber || null,
        },
        unit: unit
          ? {
            id: String(unit._id),
            wingName: unit.wingName,
            unitNumber: unit.unitNumber,
          }
          : null,
        vehicleNumber: updated.vehicleNumber || null,
        accompanyingCount: updated.accompanyingCount || 0,
        imageUrl: updated.imageUrl || null,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update guest invite entry details'));
  }
};

module.exports = {
  createGroupInvite,
  createFrequentInvite,
  createQuickInvite,
  getRecentGuests,
  scanGuestInvite,
  updateGuestInviteEntryDetails,
};
