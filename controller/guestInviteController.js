const QRCode = require('qrcode');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const GuestInvite = require('../model/guestInviteSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const DeliveryCompany = require('../model/deliveryCompanySchema');
const TaxiDriverCompany = require('../model/taxiDriverCompanySchema');
const OtherVisitorCompany = require('../model/otherVisitorCompanySchema');
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
const { getOtherVisitorCompanyInfo } = require('../utils/otherVisitorCompanies');
const { getTaxiCompanyInfo } = require('../utils/taxiDriverCompanies');

const escapeRegex = (value) => (value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCompanyId = (name) =>
  (name || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const resolveVisitorCompanyLogo = async (visitorType, companyName) => {
  const trimmed = (companyName || '').toString().trim();
  if (!trimmed) {
    return '/assets/Default.png';
  }

  const base = normalizeCompanyId(trimmed);
  let record = null;
  let fallback = null;

  switch ((visitorType || '').toString().trim().toLowerCase()) {
    case 'taxi_vehicle_driver': {
      if (base) {
        record = await TaxiDriverCompany.findOne({ id: base }).lean();
      }
      if (!record) {
        const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
        record = await TaxiDriverCompany.findOne({ name: nameRegex }).lean();
      }
      fallback = getTaxiCompanyInfo(trimmed)?.imageUrl || null;
      break;
    }
    case 'other_visitor': {
      if (base) {
        record = await OtherVisitorCompany.findOne({ id: base }).lean();
      }
      if (!record) {
        const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
        record = await OtherVisitorCompany.findOne({ name: nameRegex }).lean();
      }
      fallback = getOtherVisitorCompanyInfo(trimmed)?.imageUrl || null;
      break;
    }
    case 'delivery_executive':
    default: {
      if (base) {
        record = await DeliveryCompany.findOne({ id: base }).lean();
      }
      if (!record) {
        const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
        record = await DeliveryCompany.findOne({ name: nameRegex }).lean();
      }
      break;
    }
  }
  return record?.imageUrl || fallback || '/assets/Default.png';
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

const buildGuestInviteQrPayload = ({ invite, guest }) => {
  // Minimal payload - only essential identifiers; rest fetched from DB on scan
  const payload = {
    t: 'gi', // type: gatepal_guest_invite (shortened)
    v: 2,    // version
    i: invite.inviteId,
    g: guest.guestId,
  };
  return JSON.stringify(payload);
};

// For group invites - single shared QR for all guests
const buildGroupInviteQrPayload = ({ invite }) => {
  // Minimal payload - only essential identifiers
  const payload = {
    t: 'gi', // type: gatepal_guest_invite (shortened)
    v: 2,    // version
    i: invite.inviteId,
    g: 'group',
  };
  return JSON.stringify(payload);
};

const generateGuestQrCodes = async ({ invite }) => {
  const updatedGuests = [];
  for (const guest of invite.guests) {
    try {
      const payload = buildGuestInviteQrPayload({ invite, guest });
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

    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
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
      const payload = buildGroupInviteQrPayload({ invite });
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

    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
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

    // Generate individual QR codes for each guest
    const updatedGuests = await generateGuestQrCodes({ invite });
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

    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
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
      maxEntries: cleanedGuests.length,
    });

    const member = await User.findById(authUser._id).lean();

    // Generate individual QR codes for each guest
    const updatedGuests = await generateGuestQrCodes({ invite });
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

const updateGuestInviteForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can update guest invites', 403));
    }

    const inviteId = normalizeString(req.body?.inviteId);
    const {
      unitId,
      validFrom,
      validTill,
      validityHours,
      dateOption,
      selectedDate,
      validityType,
      untilTimeOption,
      startingFrom,
      guestCount,
      allowEntryFor,
      startDate,
      endDate,
      guests,
      isPrivateInvite,
    } = req.body || {};

    if (!inviteId) return next(createHttpError('inviteId is required', 400));
    if (!unitId) return next(createHttpError('unitId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const invite = await GuestInvite.findOne({
      inviteId,
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
    });
    if (!invite) return next(createHttpError('Guest invite not found', 404));
    if (invite.status !== 'active') {
      return next(createHttpError('Only active guest invites can be updated', 409));
    }

    let window;
    try {
      if (invite.type === 'group') {
        window = computeGroupInviteValidityWindow({
          selectedDate,
          startingFrom,
          validityHours,
        });
      } else if (invite.type === 'frequent') {
        window = computeFrequentInviteValidityWindow({
          allowEntryFor,
          startDate,
          endDate,
        });
      } else {
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
      }
    } catch (e) {
      return next(e);
    }

    let updatedGuests = null;
    if (Array.isArray(guests) && guests.length > 0 && invite.type !== 'group') {
      try {
        updatedGuests = sanitizeGuests(guests);
      } catch (e) {
        return next(e);
      }
    }

    if (invite.type === 'group' && guestCount !== undefined) {
      const countNumber = Number(guestCount);
      if (!Number.isFinite(countNumber) || countNumber <= 0) {
        return next(createHttpError('guestCount must be a positive number', 400));
      }
      invite.maxEntries = countNumber;
    }

    if (updatedGuests) {
      invite.guests = updatedGuests;
      invite.maxEntries = invite.type === 'quick' ? updatedGuests.length : invite.maxEntries;
    }

    if (isPrivateInvite !== undefined && invite.type !== 'group') {
      invite.isPrivateInvite = Boolean(isPrivateInvite);
    }

    invite.validFrom = window.validFrom;
    invite.validTill = window.validTill;

    const member = await User.findById(authUser._id).lean();

    if (invite.type === 'group') {
      let qrCodeImage = null;
      try {
        const payload = buildGuestInviteQrPayload({ invite, unit: unitDoc, member, guest: invite.guests[0] });
        qrCodeImage = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
        });
      } catch (e) {
        qrCodeImage = null;
      }
      invite.qrCodeImage = qrCodeImage;
      invite.qrCodeGeneratedAt = qrCodeImage ? new Date() : null;
    } else {
      const regeneratedGuests = await generateGuestQrCodes({ invite });
      invite.guests = regeneratedGuests;
    }

    await invite.save();

    const dateLabel = toISTDateLabel(invite.validFrom);
    const fromTimeLabel = toISTTimeLabel(invite.validFrom);
    const tillTimeLabel = toISTTimeLabel(invite.validTill);
    const validityLabel = `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`;

    return sendSuccessResponse(res, 200, 'Guest invite updated successfully', {
      data: {
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
        qrCodeImage: invite.qrCodeImage || null,
        maxEntries: invite.maxEntries,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update guest invite'));
  }
};

const cancelGuestInviteForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can cancel guest invites', 403));
    }

    const inviteId = normalizeString(req.body?.inviteId);
    const unitId = normalizeString(req.body?.unitId);
    const reason = normalizeString(req.body?.reason);
    const description = normalizeString(req.body?.description);

    if (!inviteId) return next(createHttpError('inviteId is required', 400));
    if (!unitId) return next(createHttpError('unitId is required', 400));
    if (!reason) return next(createHttpError('reason is required', 400));
    if (reason.toLowerCase() === 'other' && !description) {
      return next(createHttpError('description is required when reason is other', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const invite = await GuestInvite.findOne({
      inviteId,
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
    });
    if (!invite) return next(createHttpError('Guest invite not found', 404));
    if (invite.status === 'cancelled') {
      return next(createHttpError('Guest invite is already cancelled', 409));
    }

    const hasArrived = (invite.guests || []).some((g) => g?.hasArrived);
    const hasEntryLogs = Array.isArray(invite.entryLogs) && invite.entryLogs.length > 0;
    if (hasArrived || hasEntryLogs) {
      return next(createHttpError('Cannot delete guest invite while visitor is inside society', 409));
    }

    await GuestInvite.deleteOne({ _id: invite._id });

    return sendSuccessResponse(res, 200, 'Guest invite deleted successfully', {
      data: {
        inviteId: invite.inviteId,
        status: 'Deleted',
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete guest invite'));
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

    const { qrData: qrDataRaw, qrCodeImage, vehicleNumber, accompanyingCount } = req.body || {};

    const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
    const activeDuty = guardSocieties.find((s) => s.isOnDuty === true);

    if (!activeDuty) {
      return next(createHttpError('You must be on duty to scan guest invites', 400));
    }

    let payload;
    try {
      let text = normalizeString(qrDataRaw);
      if (!text && qrCodeImage) {
        const base64Match = qrCodeImage.toString().trim();
        const base64Data = base64Match.includes('base64,')
          ? base64Match.split('base64,').pop()
          : base64Match;
        const buffer = Buffer.from(base64Data, 'base64');
        const image = await Jimp.read(buffer);
        const width = image.width;
        const height = image.height;
        // Convert Jimp bitmap data to Uint8ClampedArray for jsQR
        const imageData = new Uint8ClampedArray(image.bitmap.data);
        const decoded = jsQR(imageData, width, height);
        if (!decoded) {
          console.log('jsQR failed to decode QR code from image');
          return next(createHttpError('Could not decode QR code from image', 400));
        }
        text = normalizeString(decoded.data);
      }
      if (!text) {
        return next(createHttpError('qrData is required', 400));
      }
      payload = JSON.parse(text);
    } catch (e) {
      console.log('QR decode error:', e.message);
      return next(createHttpError('Invalid QR data', 400));
    }

    // Handle different QR types
    // Support both old format (type: 'gatepal_*') and new compact format (t: 'gi')
    let qrType = payload.type || null;
    if (!qrType && payload.t) {
      // Map compact type codes to full type names
      const typeMap = { gi: 'gatepal_guest_invite', v: 'gatepal_visitor', m: 'gatepal_member' };
      qrType = typeMap[payload.t] || null;
    }
    // Also normalize payload fields from compact to full names for guest invites
    if (qrType === 'gatepal_guest_invite' && payload.t === 'gi') {
      payload.inviteId = payload.i;
      payload.guestId = payload.g;
    }
    
    // If it's a visitor QR (delivery_executive, taxi_driver, other_visitor, guest already onboarded)
    if (qrType === 'gatepal_visitor') {
      const visitorType = (payload.visitorType || '').toString().trim().toLowerCase();
      const isGuest = visitorType === 'guest';
      const companyLogo = isGuest ? null : await resolveVisitorCompanyLogo(payload.visitorType, payload.companyName);
      // Fetch visitor's profile photo from database
      let imageUrl = null;
      if (payload.userId) {
        const visitor = await User.findById(payload.userId).select('profilePhoto').lean();
        imageUrl = visitor?.profilePhoto || null;
      }
      return sendSuccessResponse(res, 200, 'Visitor QR code scanned successfully', {
        qrType: 'visitor',
        visitorInfo: {
          userId: payload.userId || null,
          role: payload.role || 'visitor',
          visitorType: payload.visitorType || null,
          fullName: payload.fullName || null,
          countryCode: payload.countryCode || '+91',
          phoneNumber: payload.phoneNumber || null,
          companyName: isGuest ? null : (payload.companyName || null),
          companyLogo: isGuest ? null : companyLogo,
          workCategory: isGuest ? null : (payload.workCategory || null),
          imageUrl,
        },
        message: 'QR validated successfully. Click a picture to continue.',
      });
    }

    // If it's a member QR
    if (qrType === 'gatepal_member') {
      return sendSuccessResponse(res, 200, 'Member QR code scanned successfully', {
        qrType: 'member',
        memberInfo: {
          memberId: payload.memberId || null,
          userId: payload.userId || null,
          role: payload.role || 'member',
          societyId: payload.societyId || null,
          societyName: payload.societyName || null,
          wingName: payload.wingName || null,
          unitNumber: payload.unitNumber || null,
        },
        message: 'QR validated successfully. Click a picture to continue.',
      });
    }

    // Guest invite QR
    if (qrType !== 'gatepal_guest_invite' || !payload.inviteId) {
      return next(createHttpError('QR code is not a valid GatePal QR', 400));
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

    // For group invites, guestId is 'group' - skip individual guest lookup
    if (guestId && guestId !== 'group') {
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

    const normalizedVehicleNumber = normalizeString(vehicleNumber).toUpperCase() || null;
    const countNumber = Number(accompanyingCount);
    const safeCount = Number.isFinite(countNumber) && countNumber > 0 ? countNumber : 0;

    // Add entry log with guest information
    invite.entryLogs.push({
      guestId: guestId || 'group',
      guestName: arrivingGuest ? arrivingGuest.name : 'Group Guest',
      scannedAt: now,
      guardId: authUser._id,
      gateId: activeDuty.dutyGateId || null,
      gateName: activeDuty.dutyGateName || null,
      vehicleNumber: normalizedVehicleNumber,
      accompanyingCount: safeCount,
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
      qrType: 'guest_invite',
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
      vehicleNumber: normalizedVehicleNumber,
      accompanyingCount: safeCount,
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

const getRecentGuests = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'member') {
      return next(createHttpError('Only members can view recent guests', 403));
    }

    const daysNumber = Number(req.body?.days);
    const limitNumber = Number(req.body?.limit);
    const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(limitNumber, 50) : 20;
    const days = Number.isFinite(daysNumber) && daysNumber > 0 ? Math.min(daysNumber, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const invites = await GuestInvite.find(
      {
        invitedByUserId: authUser._id,
        createdAt: { $gte: since },
      },
      { guests: 1, createdAt: 1 }
    )
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const byKey = new Map();

    const upsert = (key, candidate) => {
      if (!key) return;
      const existing = byKey.get(key);
      if (!existing || new Date(candidate.lastInvitedAt).getTime() > new Date(existing.lastInvitedAt).getTime()) {
        byKey.set(key, candidate);
      }
    };

    for (const invite of invites) {
      const guests = Array.isArray(invite.guests) ? invite.guests : [];
      for (const g of guests) {
        if (!g) continue;
        const name = normalizeString(g.name);
        const phoneDigits = g.phoneDigits || (g.phoneNumber ? normalizeDigits(g.phoneNumber) : null);
        const key = phoneDigits || `${name.toLowerCase()}|${String(g.guestId || '')}`;
        upsert(key, {
          name: name || null,
          countryCode: g.countryCode || null,
          phoneNumber: g.phoneNumber || null,
          source: g.source || 'recent',
          lastInvitedAt: invite.createdAt,
        });
      }
    }

    const recentGuests = Array.from(byKey.values())
      .filter((g) => g.name || g.phoneNumber)
      .sort((a, b) => new Date(b.lastInvitedAt).getTime() - new Date(a.lastInvitedAt).getTime())
      .slice(0, limit);

    return sendSuccessResponse(res, 200, 'Recent guests fetched successfully', {
      data: { guests: recentGuests },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch recent guests'));
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

    const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
    const activeDuty = guardSocieties.find((s) => s.isOnDuty === true);

    if (!activeDuty) {
      return next(createHttpError('You must be on duty to update entry details', 400));
    }

    const { inviteId, guestId, vehicleNumber, accompanyingCount } = req.body || {};

    const normalizedInviteId = normalizeString(inviteId);
    if (!normalizedInviteId) {
      return next(createHttpError('inviteId is required', 400));
    }

    const invite = await GuestInvite.findOne({ inviteId: normalizedInviteId });

    if (!invite) {
      return next(createHttpError('Guest invite not found', 404));
    }

    if (String(invite.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Invite does not belong to this society', 403));
    }

    const logs = Array.isArray(invite.entryLogs) ? invite.entryLogs : [];
    let targetLogIndex = -1;

    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const log = logs[index];
      if (!log) continue;
      if (String(log.guardId) !== String(authUser._id)) continue;
      if (guestId && log.guestId !== guestId) continue;
      targetLogIndex = index;
      break;
    }

    if (targetLogIndex === -1) {
      return next(createHttpError('No entry scan found to update for this invite', 404));
    }

    const normalizedVehicleNumber =
      vehicleNumber === undefined ? undefined : normalizeString(vehicleNumber).toUpperCase() || null;

    const countNumber = Number(accompanyingCount);
    const safeCount =
      accompanyingCount === undefined
        ? undefined
        : Number.isFinite(countNumber) && countNumber >= 0
          ? countNumber
          : null;

    if (normalizedVehicleNumber !== undefined) {
      invite.entryLogs[targetLogIndex].vehicleNumber = normalizedVehicleNumber;
    }

    if (safeCount !== undefined) {
      if (safeCount === null) {
        return next(createHttpError('accompanyingCount must be a non-negative number', 400));
      }
      invite.entryLogs[targetLogIndex].accompanyingCount = safeCount;
    }

    await invite.save();

    return sendSuccessResponse(res, 200, 'Entry details updated successfully', {
      data: {
        inviteId: invite.inviteId,
        entryLog: invite.entryLogs[targetLogIndex],
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update entry details'));
  }
};

module.exports = {
  createGroupInvite,
  createFrequentInvite,
  createQuickInvite,
  updateGuestInviteForMember,
  cancelGuestInviteForMember,
  scanGuestInvite,
  updateGuestInviteEntryDetails,
  getRecentGuests,
};
