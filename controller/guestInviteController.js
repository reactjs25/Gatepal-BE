const QRCode = require('qrcode');
const GuestInvite = require('../model/guestInviteSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { normalizeString } = require('../utils/strings');
const {
  normalizeCountryCode,
  normalizeDigits,
  isTenDigitPhone,
} = require('../utils/phoneNumber');
const { toISTDateLabel, toISTTimeLabel } = require('../utils/dateTime');

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
      name,
      countryCode: countryCode || '+91',
      phoneNumber,
      phoneDigits,
      source,
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

const buildGuestInviteQrPayload = ({ invite, unit, member }) => {
  const payload = {
    type: 'gatepal_guest_invite',
    version: 1,
    inviteId: invite.inviteId,
    societyId: String(invite.societyId),
    unitId: String(invite.unitId),
    unitWing: unit.wingName,
    unitNumber: unit.unitNumber,
    invitedByUserId: String(invite.invitedByUserId),
    invitedByName: member.fullName || '',
    inviteType: invite.type,
    validFrom: invite.validFrom.toISOString(),
    validTill: invite.validTill.toISOString(),
  };
  return JSON.stringify(payload);
};

const createGroupInvite = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can create guest invites', 403));
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

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate during the valid time window.`;

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

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can create guest invites', 403));
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
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel,
      qrCodeImage: invite.qrCodeImage || null,
      maxEntries: null,
    };

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate during the valid time window.`;

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

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can create guest invites', 403));
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
      maxEntries: 1,
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
    };

    const shareMessage = `${authUser.fullName || 'A member'} has invited you. Show this QR code to the guard at the gate during the valid time window.`;

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

    const { qrData, vehicleNumber, accompanyingCount } = req.body || {};

    const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
    const activeDuty = guardSocieties.find((s) => s.isOnDuty === true);

    if (!activeDuty) {
      return next(createHttpError('You must be on duty to scan guest invites', 400));
    }

    let payload;
    try {
      const text = normalizeString(qrData);
      if (!text) {
        return next(createHttpError('qrData is required', 400));
      }
      payload = JSON.parse(text);
    } catch (e) {
      return next(createHttpError('Invalid QR data', 400));
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

    const usedEntries = Array.isArray(invite.entryLogs) ? invite.entryLogs.length : 0;
    const hasEntryLimit = invite.type !== 'frequent';
    if (hasEntryLimit && usedEntries >= invite.maxEntries) {
      return next(createHttpError('Entry already used for this invite', 400));
    }

    const normalizedVehicleNumber = normalizeString(vehicleNumber).toUpperCase() || null;
    const countNumber = Number(accompanyingCount);
    const safeCount = Number.isFinite(countNumber) && countNumber > 0 ? countNumber : 0;

    invite.entryLogs.push({
      scannedAt: now,
      guardId: authUser._id,
      gateId: activeDuty.dutyGateId || null,
      gateName: activeDuty.dutyGateName || null,
      vehicleNumber: normalizedVehicleNumber,
      accompanyingCount: safeCount,
    });

    await invite.save();

    const member = await User.findById(invite.invitedByUserId).lean();
    const unit = await MemberUnit.findById(invite.unitId).lean();

    const dateLabel = toISTDateLabel(invite.validFrom);
    const fromTimeLabel = toISTTimeLabel(invite.validFrom);
    const tillTimeLabel = toISTTimeLabel(invite.validTill);

    const usedEntriesAfterScan = usedEntries + 1;
    const remainingEntries =
      hasEntryLimit && Number.isFinite(invite.maxEntries)
        ? Math.max(invite.maxEntries - usedEntriesAfterScan, 0)
        : null;

    const responseData = {
      inviteId: invite.inviteId,
      inviteType: invite.type,
      societyId: String(invite.societyId),
      unitId: String(invite.unitId),
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
      guests: invite.guests.map((g) => ({
        name: g.name,
        countryCode: g.countryCode,
        phoneNumber: g.phoneNumber,
      })),
      validFrom: invite.validFrom,
      validTill: invite.validTill,
      validityLabel: `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`,
      vehicleNumber: normalizedVehicleNumber,
      accompanyingCount: safeCount,
      maxEntries: hasEntryLimit ? invite.maxEntries : null,
      usedEntries: usedEntriesAfterScan,
      remainingEntries,
      message: 'QR validated successfully. Click a picture to continue.',
    };

    return sendSuccessResponse(res, 200, 'Guest invite validated successfully', {
      data: responseData,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to validate guest invite'));
  }
};

module.exports = {
  createGroupInvite,
  createFrequentInvite,
  createQuickInvite,
  scanGuestInvite,
};
