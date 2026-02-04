const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const GuestEntryRequestDraft = require('../model/guestEntryRequestDraftSchema');
const GuestInvite = require('../model/guestInviteSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const { lookupSocietyAdminByMobile } = require('../utils/societyAdminUtils');
const TaxiDriverCompany = require('../model/taxiDriverCompanySchema');
const DeliveryCompany = require('../model/deliveryCompanySchema');
const OtherVisitorCompany = require('../model/otherVisitorCompanySchema');
const DeliveryPreApproval = require('../model/deliveryPreApprovalSchema');
const TaxiDriverPreApproval = require('../model/taxiDriverPreApprovalSchema');
const OtherVisitorPreApproval = require('../model/otherVisitorPreApprovalSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { normalizeString } = require('../utils/strings');
const { getTaxiCompanyInfo } = require('../utils/taxiDriverCompanies');
const { getOtherVisitorCompanyInfo } = require('../utils/otherVisitorCompanies');
const { getWorkCategoryDisplayName } = require('../utils/workCategories');
const { normalizeCountryCode, normalizeDigits, normalizePhoneDigits, isTenDigitPhone } = require('../utils/phoneNumber');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { toISTDateLabel, toISTDateTimeLabel, toISTDateTimeLabelNoComma, toISTTimeLabel } = require('../utils/dateTime');
const { sendToUsers, sendToUser } = require('../utils/pushNotificationService');

const VISITOR_TYPE_LABELS = {
  guest: { category: 'Guest', visitorType: 'Guest' },
  delivery_executive: { category: 'Delivery', visitorType: 'Delivery Executive' },
  taxi_vehicle_driver: { category: 'Taxi', visitorType: 'Taxi' },
  other_visitor: { category: 'Visitor', visitorType: 'Other Visitor' },
};

// Helper function to generate notification content based on visitor type
const getNotificationContent = (doc, action) => {
  const visitorType = doc.visitorType || 'guest';
  const guestName = doc.guestName;
  const companyName = doc.visitorCompanyName;
  const wingUnit = `${doc.wingName} ${doc.unitNumber}`;
  const gateName = doc.gateName || 'the gate';

  // Determine title prefix based on visitor type
  const titlePrefix = {
    guest: 'Guest',
    delivery_executive: 'Delivery',
    taxi_vehicle_driver: 'Taxi',
    other_visitor: 'Visitor',
  }[visitorType] || 'Guest';

  // Determine visitor label for body
  let visitorLabel;
  if (companyName) {
    visitorLabel = `${guestName} from ${companyName}`;
  } else if (visitorType === 'delivery_executive') {
    visitorLabel = `Delivery executive ${guestName}`;
  } else if (visitorType === 'taxi_vehicle_driver') {
    visitorLabel = `Taxi driver ${guestName}`;
  } else if (visitorType === 'other_visitor') {
    visitorLabel = `Visitor ${guestName}`;
  } else {
    visitorLabel = guestName;
  }

  // Generate title and body based on action
  switch (action) {
    case 'approval':
      return {
        title: `${titlePrefix} Approval - ${wingUnit}`,
        body: `${visitorLabel} is waiting for your approval to enter the society.`,
      };
    case 'entry':
      return {
        title: `${titlePrefix} Entry - ${wingUnit}`,
        body: `${visitorLabel} has entered society through ${gateName}.`,
      };
    case 'exit':
      return {
        title: `${titlePrefix} Left - ${wingUnit}`,
        body: `${visitorLabel} has left your society through ${gateName}.`,
      };
    case 'approved':
      return {
        title: `${titlePrefix} Approved, ${doc.wingName}${doc.unitNumber}`,
        body: `You may allow ${visitorType === 'guest' ? 'guest' : visitorType.replace('_', ' ')} '${guestName}' to enter the society.`,
      };
    case 'denied':
      return {
        title: `${titlePrefix} Denied, ${doc.wingName}${doc.unitNumber}`,
        body: `Unit member has denied entry from the ${visitorType === 'guest' ? 'guest' : visitorType.replace('_', ' ')} '${guestName}'.`,
      };
    default:
      return { title: '', body: '' };
  }
};

const VISITOR_TYPES = ['guest', 'delivery_executive', 'taxi_vehicle_driver', 'other_visitor'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'entered', 'left', 'wrong_entry'];
const STATUS_FILTERS = {
  awaiting_approval: ['pending'],
  pending: ['pending'],
  approved: ['approved'],
  inside_society: ['entered'],
  entered: ['entered'],
  left_society: ['rejected', 'cancelled', 'expired', 'left', 'wrong_entry'],
  rejected: ['rejected'],
  denied: ['rejected'],
  cancelled: ['cancelled'],
  expired: ['expired'],
  wrong_entry: ['wrong_entry'],
  all: REQUEST_STATUSES,
};

const toVisitorLabels = (visitorTypeKey) =>
  VISITOR_TYPE_LABELS[visitorTypeKey] || VISITOR_TYPE_LABELS.guest;

const normalizeOption = (value) =>
  (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCompanyId = (name) =>
  (name || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const getStatusLabel = (status) =>
  status === 'approved'
    ? 'Approved'
    : status === 'rejected'
      ? 'Denied'
      : status === 'entered'
          ? 'Inside Society'
          : status === 'left'
            ? 'Left Society'
            : status === 'expired'
              ? 'Expired'
              : status === 'cancelled'
                ? 'Cancelled'
                : status === 'wrong_entry'
                  ? 'Wrong Entry'
                  : 'Awaiting Approval';

const resolveTaxiCompanyName = async (companyName) => {
  const trimmed = normalizeString(companyName);
  if (!trimmed) return null;

  const base = normalizeCompanyId(trimmed);
  let record = null;

  if (base) {
    record = await TaxiDriverCompany.findOne({ id: base }).lean();
  }
  if (!record) {
    const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
    record = await TaxiDriverCompany.findOne({ name: nameRegex }).lean();
  }

  if (record?.name) return record.name;

  const fallback = getTaxiCompanyInfo(trimmed);
  return fallback?.name || null;
};

const resolveCompanyLogo = ({ visitorType, companyName, deliveryCompanyLogos }) => {
  const trimmed = normalizeString(companyName);
  if (!trimmed) return null;

  if (visitorType === 'delivery_executive') {
    if (!deliveryCompanyLogos) return '/assets/Default.png';
    const logo = deliveryCompanyLogos.get(trimmed.toLowerCase());
    return logo || '/assets/Default.png';
  }

  if (visitorType === 'taxi_vehicle_driver') {
    return getTaxiCompanyInfo(trimmed)?.imageUrl || null;
  }

  if (visitorType === 'other_visitor') {
    return getOtherVisitorCompanyInfo(trimmed)?.imageUrl || null;
  }

  return null;
};

const resolveCompanyLogoForRequest = async ({ visitorType, companyName }) => {
  const trimmed = normalizeString(companyName);
  if (!trimmed) return null;

  if (visitorType === 'delivery_executive') {
    const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
    const record = await DeliveryCompany.findOne({ name: nameRegex }, { imageUrl: 1 }).lean();
    return record?.imageUrl || '/assets/Default.png';
  }

  if (visitorType === 'taxi_vehicle_driver') {
    
    const hardcodedTaxi = getTaxiCompanyInfo(trimmed);
    if (hardcodedTaxi?.imageUrl) return hardcodedTaxi.imageUrl;
    const taxiNameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
    const taxiRecord = await TaxiDriverCompany.findOne({ name: taxiNameRegex }, { imageUrl: 1 }).lean();
    return taxiRecord?.imageUrl || '/assets/Default.png';
  }

  if (visitorType === 'other_visitor') {
    
    const hardcodedOther = getOtherVisitorCompanyInfo(trimmed);
    if (hardcodedOther?.imageUrl) return hardcodedOther.imageUrl;
    const otherNameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
    const otherRecord = await OtherVisitorCompany.findOne({ name: otherNameRegex }, { imageUrl: 1 }).lean();
    return otherRecord?.imageUrl || '/assets/Default.png';
  }

  return null;
};

const resolveActiveStatus = (status, validTill, now) => {
  if (status === 'active' && validTill) {
    const validTillMs = new Date(validTill).getTime();
    if (Number.isFinite(validTillMs) && validTillMs <= now.getTime()) {
      return 'expired';
    }
  }
  return status;
};

const expirePendingGuestEntryRequests = async ({ societyId, wingNameLower, unitNumberLower, now }) => {
  if (!societyId || !wingNameLower || !unitNumberLower) return;
  await GuestEntryRequest.updateMany(
    {
      societyId,
      wingNameLower,
      unitNumberLower,
      status: 'pending',
      expiresAt: { $ne: null, $lte: now },
    },
    { $set: { status: 'expired' } }
  );
};

const expirePreApprovalsAndInvites = async ({ societyId, unitId, now }) => {
  if (!societyId || !unitId) return;
  const expiryQuery = {
    societyId,
    unitId,
    status: 'active',
    validTill: { $lte: now },
  };
  await Promise.all([
    DeliveryPreApproval.updateMany(expiryQuery, { $set: { status: 'expired' } }),
    TaxiDriverPreApproval.updateMany(expiryQuery, { $set: { status: 'expired' } }),
    OtherVisitorPreApproval.updateMany(expiryQuery, { $set: { status: 'expired' } }),
    GuestInvite.updateMany(expiryQuery, { $set: { status: 'expired' } }),
  ]);
};

const findDeliveryPreApproval = async ({ societyId, unitId, companyName, now }) => {
  if (!societyId || !unitId) return null;
  const trimmedCompany = normalizeString(companyName);
  const query = {
    societyId,
    unitId,
    status: 'active',
    validFrom: { $lte: now },
    validTill: { $gte: now },
  };
  if (trimmedCompany) {
    const nameRegex = new RegExp(`^${escapeRegex(trimmedCompany)}$`, 'i');
    query.$or = [{ companyName: null }, { companyName: '' }, { companyName: nameRegex }];
  }
  return DeliveryPreApproval.findOne(query).sort({ validFrom: -1 }).lean();
};

const findTaxiPreApproval = async ({ societyId, unitId, companyName, vehicleNumber, now }) => {
  if (!societyId || !unitId) return null;
  const trimmedCompany = normalizeString(companyName);
  if (!trimmedCompany) return null;
  const nameRegex = new RegExp(`^${escapeRegex(trimmedCompany)}$`, 'i');
  const query = {
    societyId,
    unitId,
    status: 'active',
    validFrom: { $lte: now },
    validTill: { $gte: now },
    companyName: nameRegex,
  };
  if (vehicleNumber) {
    query.$or = [{ vehicleNumber: null }, { vehicleNumber: '' }, { vehicleNumber }];
  } else {
    query.$or = [{ vehicleNumber: null }, { vehicleNumber: '' }];
  }
  return TaxiDriverPreApproval.findOne(query).sort({ validFrom: -1 }).lean();
};

const findOtherVisitorPreApproval = async ({ societyId, unitId, workCategory, companyName, now }) => {
  if (!societyId || !unitId) return null;
  const resolvedWorkCategory = getWorkCategoryDisplayName(workCategory);
  if (!resolvedWorkCategory) return null;
  const workCategoryRegex = new RegExp(`^${escapeRegex(resolvedWorkCategory)}$`, 'i');
  const trimmedCompany = normalizeString(companyName);
  const query = {
    societyId,
    unitId,
    status: 'active',
    validFrom: { $lte: now },
    validTill: { $gte: now },
    workCategory: workCategoryRegex,
  };
  if (trimmedCompany) {
    const nameRegex = new RegExp(`^${escapeRegex(trimmedCompany)}$`, 'i');
    query.$or = [{ companyName: null }, { companyName: '' }, { companyName: nameRegex }];
  }
  return OtherVisitorPreApproval.findOne(query).sort({ validFrom: -1 }).lean();
};

const findGuestInviteApproval = async ({ societyId, unitId, guestName, phoneDigits, now }) => {
  if (!societyId || !unitId) return null;
  const normalizedName = normalizeString(guestName).toLowerCase();
  const invites = await GuestInvite.find(
    {
      societyId,
      unitId,
      status: 'active',
      validFrom: { $lte: now },
      validTill: { $gte: now },
      guests: { $exists: true },
    },
    { invitedByUserId: 1, type: 1, guests: 1 }
  )
    .sort({ validFrom: -1 })
    .limit(20)
    .lean();

  for (const invite of invites) {
    if (!Array.isArray(invite.guests) || invite.guests.length === 0) continue;
    const matched = invite.guests.find((g) => {
      if (!g) return false;
      const guestPhone = g.phoneDigits || (g.phoneNumber ? normalizeDigits(g.phoneNumber) : null);
      if (phoneDigits && guestPhone && phoneDigits === guestPhone) return true;
      const guestNameMatch = normalizeString(g.name).toLowerCase();
      return normalizedName && guestNameMatch === normalizedName;
    });
    if (matched) return invite;
  }
  return null;
};

const resolvePreApprovalForUnit = async ({
  visitorType,
  societyId,
  unitId,
  companyName,
  workCategory,
  vehicleNumber,
  guestName,
  phoneDigits,
  now,
}) => {
  if (!visitorType) return null;
  switch (visitorType) {
    case 'delivery_executive':
      return findDeliveryPreApproval({ societyId, unitId, companyName, now });
    case 'taxi_vehicle_driver':
      return findTaxiPreApproval({ societyId, unitId, companyName, vehicleNumber, now });
    case 'other_visitor':
      return findOtherVisitorPreApproval({ societyId, unitId, workCategory, companyName, now });
    case 'guest':
      return findGuestInviteApproval({ societyId, unitId, guestName, phoneDigits, now });
    default:
      return null;
  }
};

const resolveExistingVisitorPhoto = async ({ phoneDigits, visitorType }) => {
  if (!phoneDigits) return null;

  if (visitorType && visitorType !== 'guest') {
    const visitor = await User.findOne(
      { phoneNumber: phoneDigits, role: 'visitor', visitorType },
      { profilePhoto: 1 }
    ).lean();
    if (visitor?.profilePhoto) return visitor.profilePhoto;
  }

  const previousEntry = await GuestEntryRequest.findOne(
    { guestPhoneDigits: phoneDigits, guestImageUrl: { $ne: null } },
    { guestImageUrl: 1 }
  )
    .sort({ createdAt: -1 })
    .lean();
  if (previousEntry?.guestImageUrl) return previousEntry.guestImageUrl;

  const recentInvite = await GuestInvite.findOne(
    {
      $or: [{ 'entryLogs.guestPhoneDigits': phoneDigits }, { 'entryLogs.guestPhoneNumber': phoneDigits }],
      'entryLogs.imageUrl': { $ne: null },
    },
    { entryLogs: 1 }
  )
    .sort({ createdAt: -1 })
    .lean();

  if (recentInvite?.entryLogs?.length) {
    const matchedLog = recentInvite.entryLogs.find((log) => {
      if (!log || !log.imageUrl) return false;
      const digits = normalizeDigits(log.guestPhoneDigits || log.guestPhoneNumber || '');
      return digits === phoneDigits;
    });
    if (matchedLog?.imageUrl) return matchedLog.imageUrl;
  }

  return null;
};

const resolveAdminSocietyId = async (authUser) => {
  if (!authUser) {
    throw createHttpError('Unauthorized', 401);
  }
  if (authUser.adminSocietyId) {
    return authUser.adminSocietyId;
  }
  if (authUser.societyId) {
    return authUser.societyId;
  }
  const digits = normalizeDigits(authUser.phoneNumber || '');
  const match = digits ? await lookupSocietyAdminByMobile(digits) : null;
  if (!match?.societyId) {
    throw createHttpError('Society not found', 404);
  }
  return match.societyId;
};

const requireGuardOnDuty = (authUser) => {
  const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
  const activeDuty = guardSocieties.find((s) => s.isOnDuty === true);
  if (!activeDuty) {
    throw createHttpError('You must be on duty to perform this action', 400);
  }
  return activeDuty;
};

const checkVisitorAlreadyInside = async ({ societyId, phoneDigits }) => {
  if (!societyId || !phoneDigits) return null;
  
  const normalizedPhone = normalizePhoneDigits(phoneDigits);
  if (!normalizedPhone) return null;
  
  const existingEntry = await GuestEntryRequest.findOne({
    societyId,
    guestPhoneDigits: normalizedPhone,
    status: 'entered',
  }).lean();
  
  return existingEntry || null;
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

const toGuardCardPayload = ({ reqDoc, approvedByUser, approvedByGuard, companyLogo }) => {
  const statusLabel = getStatusLabel(reqDoc.status);


  const labels = toVisitorLabels(reqDoc.visitorType || 'guest');

  let approvedByInfo = null;
  let approvedOnDate = null;

  if (reqDoc.approvedByGuardWithoutMemberResponse && approvedByGuard) {
    approvedByInfo = {
      id: String(approvedByGuard._id),
      name: approvedByGuard.fullName ? `${approvedByGuard.fullName} (Security Guard)` : 'Security Guard',
      countryCode: approvedByGuard.countryCode || '+91',
      phoneNumber: approvedByGuard.phoneNumber || null,
      isGuard: true,
    };
    approvedOnDate = reqDoc.approvedByGuardAt;
  } else if (approvedByUser) {
    approvedByInfo = {
      id: String(approvedByUser._id),
      name: approvedByUser.fullName || null,
      countryCode: approvedByUser.countryCode || '+91',
      phoneNumber: approvedByUser.phoneNumber || null,
      isGuard: false,
    };
    approvedOnDate = reqDoc.approvedAt;
  }

  return {

    requestId: reqDoc.requestId,
    category: labels.category,
    status: statusLabel,
    name: reqDoc.guestName,
    visitorType: labels.visitorType,
    phone: {
      countryCode: reqDoc.guestCountryCode || '+91',
      phoneNumber: reqDoc.guestPhoneNumber,

    },
    accompanyingPerson: String(reqDoc.accompanyingCount || 0),
    vehicleNumber: reqDoc.vehicleNumber || null,
    unit: {
      wingName: reqDoc.wingName,
      unitNumber: reqDoc.unitNumber,

    },
    imageUrl: reqDoc.guestImageUrl || null,
    companyName: reqDoc.visitorCompanyName || null,
    companyLogo: companyLogo || null,
    workCategory: reqDoc.visitorWorkCategory || null,
    approvedBy: approvedByInfo,
    approvedOn: approvedOnDate ? toISTDateTimeLabel(approvedOnDate) : null,
    requestedOn: reqDoc.createdAt ? toISTDateTimeLabel(reqDoc.createdAt) : null,
  };
};


const getRecentGuestsForGuard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const wingName = normalizeString(req.body?.wingName ?? req.body?.wing);
    const unitNumberRaw = req.body?.unitNumber ?? req.body?.unit;
    const unitNumbers = Array.isArray(unitNumberRaw)
      ? unitNumberRaw.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    const unitNumber = Array.isArray(unitNumberRaw) ? null : normalizeString(unitNumberRaw);
    const daysNumber = Number(req.body?.days);

    if (!wingName) return next(createHttpError('wingName is required', 400));
    if (unitNumbers.length === 0 && !unitNumber) {
      return next(createHttpError('unitNumber is required', 400));
    }

    const limit = 20;
    const days = Number.isFinite(daysNumber) && daysNumber > 0 ? Math.min(daysNumber, 365) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const unitDocs = await MemberUnit.find(
      {
        societyId: activeDuty.societyId,
        wingNameLower: wingName.toLowerCase(),
        unitNumberLower: unitNumber.toLowerCase(),
      },
      { _id: 1 }
    ).lean();

    const unitIds = (unitDocs || []).map((u) => u._id);

    if (!unitIds || unitIds.length === 0) {
      return sendSuccessResponse(res, 200, 'Recent guests fetched successfully', {
        data: {
          unit: { wingName, unitNumber },
          guests: [],
        },
      });
    }

    const invites = await GuestInvite.find(
      {
        societyId: activeDuty.societyId,
        unitId: { $in: unitIds },
        createdAt: { $gte: since },
        $or: [{ 'entryLogs.0': { $exists: true } }, { 'guests.hasArrived': true }],
      },
      { type: 1, guests: 1, entryLogs: 1, createdAt: 1 }
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const byKey = new Map();

    const upsert = (key, candidate) => {
      if (!key) return;
      const existing = byKey.get(key);
      if (
        !existing ||
        new Date(candidate.lastVisitedAt).getTime() > new Date(existing.lastVisitedAt).getTime()
      ) {
        byKey.set(key, candidate);
      }
    };

    for (const invite of invites) {
      const entryLogImageByGuestId = new Map();
      for (const log of invite.entryLogs || []) {
        if (!log?.guestId || !log.imageUrl) continue;
        const key = String(log.guestId);
        const scannedAt = log.scannedAt || invite.createdAt;
        const existing = entryLogImageByGuestId.get(key);
        if (!existing || new Date(scannedAt).getTime() > new Date(existing.scannedAt).getTime()) {
          entryLogImageByGuestId.set(key, { imageUrl: log.imageUrl, scannedAt });
        }
      }

      if (invite.type === 'quick' || invite.type === 'frequent') {
        for (const g of invite.guests || []) {
          if (!g || !g.hasArrived || !g.arrivedAt) continue;
          const phoneDigits = g.phoneDigits || (g.phoneNumber ? normalizeDigits(g.phoneNumber) : null);
          const key = phoneDigits || `${(g.name || '').toLowerCase()}|${String(g.guestId || '')}`;
          const entryLogImage = g.guestId
            ? entryLogImageByGuestId.get(String(g.guestId))?.imageUrl || null
            : null;
          upsert(key, {
            name: g.name || null,
            countryCode: g.countryCode || null,
            phoneNumber: g.phoneNumber || null,
            lastVisitedAt: g.arrivedAt,
            imageUrl: entryLogImage,
            source: g.source || 'recent',
          });
        }
      }

      if (invite.type === 'group') {
        for (const log of invite.entryLogs || []) {
          if (!log) continue;
          const name = (log.guestName || '').toString().trim();
          const isPlaceholderName = name.toLowerCase() === 'group guest';
          const hasPhone = Boolean((log.guestPhoneDigits || log.guestPhoneNumber || '').toString().trim());
          if (isPlaceholderName && !hasPhone) continue;
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
        unit: { wingName, unitNumber },
        guests: recentGuests,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch recent guests'));
  }
};

const listGuestEntryRequestsForGuard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const statusKey = normalizeOption(req.body?.status ?? req.body?.statusKey ?? 'awaiting_approval');
    const visitorTypeRaw = req.body?.visitorType ?? req.body?.visitorTypeKey;

    const visitorTypes =
      Array.isArray(visitorTypeRaw)
        ? visitorTypeRaw.map((v) => normalizeOption(v)).filter(Boolean)
        : normalizeOption(visitorTypeRaw)
          ? [normalizeOption(visitorTypeRaw)]
          : [];

    const normalizedVisitorTypes =
      visitorTypes.length > 0
        ? visitorTypes.filter((t) => VISITOR_TYPES.includes(t))
        : VISITOR_TYPES;

    if (visitorTypes.length > 0 && normalizedVisitorTypes.length === 0) {
      return next(createHttpError('visitorType is invalid', 400));
    }

    const statusFilter = STATUS_FILTERS[statusKey] || STATUS_FILTERS.awaiting_approval;
    const shouldGroupDelivery =
      ['awaiting_approval', 'pending', 'approved'].includes(statusKey) &&
      normalizedVisitorTypes.includes('delivery_executive');
    // For delivery executives, we need to fetch both approved AND pending to detect partial approvals
    const deliveryStatusFilter =
      statusKey === 'approved'
        ? ['approved', 'pending', 'entered']
        : statusKey === 'awaiting_approval' || statusKey === 'pending'
          ? ['pending', 'approved', 'entered']
          : statusFilter;

    const now = new Date();

    await GuestEntryRequest.updateMany(
      {
        societyId: activeDuty.societyId,
        status: 'pending',
        expiresAt: { $ne: null, $lte: now },
      },
      { $set: { status: 'expired' } }
    );

    const baseProjection = {
      requestId: 1,
      visitorType: 1,
      guestName: 1,
      guestCountryCode: 1,
      guestPhoneNumber: 1,
      guestPhoneDigits: 1,
      guestImageUrl: 1,
      accompanyingCount: 1,
      vehicleNumber: 1,
      status: 1,
      wingName: 1,
      unitNumber: 1,
      visitorCompanyName: 1,
      visitorWorkCategory: 1,
      approvedByUserId: 1,
      approvedAt: 1,
      approvedByGuardWithoutMemberResponse: 1,
      approvedByGuardId: 1,
      approvedByGuardAt: 1,
      createdAt: 1,
      gateId: 1,
      createdByGuardId: 1,
    };

    let docs = [];
    if (shouldGroupDelivery) {
      const nonDeliveryTypes = normalizedVisitorTypes.filter((t) => t !== 'delivery_executive');
      const [nonDeliveryDocs, deliveryDocs] = await Promise.all([
        nonDeliveryTypes.length > 0
          ? GuestEntryRequest.find(
              {
                societyId: activeDuty.societyId,
                status: { $in: statusFilter },
                visitorType: { $in: nonDeliveryTypes },
              },
              baseProjection
            )
              .sort({ createdAt: -1 })
              .limit(100)
              .lean()
          : Promise.resolve([]),
        GuestEntryRequest.find(
          {
            societyId: activeDuty.societyId,
            status: { $in: deliveryStatusFilter },
            visitorType: 'delivery_executive',
          },
          baseProjection
        )
          .sort({ createdAt: -1 })
          .limit(200)
          .lean(),
      ]);
      docs = [...nonDeliveryDocs, ...deliveryDocs];
    } else {
      docs = await GuestEntryRequest.find(
        {
          societyId: activeDuty.societyId,
          status: { $in: statusFilter },
          visitorType: { $in: normalizedVisitorTypes },
        },
        baseProjection
      )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    }

    const deliveryCompanyNames = Array.from(
      new Set(
        (docs || [])
          .filter((d) => d.visitorType === 'delivery_executive')
          .map((d) => normalizeString(d.visitorCompanyName).toLowerCase())
          .filter(Boolean)
      )
    );

    const deliveryCompanies = deliveryCompanyNames.length
      ? await DeliveryCompany.find(
          { name: { $in: deliveryCompanyNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, 'i')) } },
          { name: 1, imageUrl: 1 }
        ).lean()
      : [];

    const deliveryCompanyLogos = new Map(
      deliveryCompanies
        .map((company) => [normalizeString(company.name).toLowerCase(), company.imageUrl || null])
        .filter(([, imageUrl]) => Boolean(imageUrl))
    );

    const approverIds = Array.from(
      new Set(
        docs
          .map((d) => d.approvedByUserId)
          .filter(Boolean)
          .map((id) => String(id))
      )
    );

    const guardApproverIds = Array.from(
      new Set(
        docs
          .filter((d) => d.approvedByGuardWithoutMemberResponse && d.approvedByGuardId)
          .map((d) => String(d.approvedByGuardId))
      )
    );

    const approvers = approverIds.length
      ? await User.find({ _id: { $in: approverIds } }, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
      : [];
    const approverById = new Map(approvers.map((u) => [String(u._id), u]));

    const guardApprovers = guardApproverIds.length
      ? await User.find({ _id: { $in: guardApproverIds } }, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
      : [];
    const guardApproverById = new Map(guardApprovers.map((u) => [String(u._id), u]));

    const deliveryDocs = shouldGroupDelivery ? docs.filter((d) => d.visitorType === 'delivery_executive') : [];
    const otherDocs = shouldGroupDelivery ? docs.filter((d) => d.visitorType !== 'delivery_executive') : docs;

    const mappedOthers = otherDocs.map((doc) => {
      const approvedByUser = doc.approvedByUserId ? approverById.get(String(doc.approvedByUserId)) : null;
      const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
        ? guardApproverById.get(String(doc.approvedByGuardId))
        : null;
      const companyLogo = resolveCompanyLogo({
        visitorType: doc.visitorType,
        companyName: doc.visitorCompanyName,
        deliveryCompanyLogos,
      });
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
      return {
        ...payload,
        statusKey: doc.status,
        visitorTypeKey: doc.visitorType || 'guest',
        _sortTime: doc.createdAt ? new Date(doc.createdAt).getTime() : 0,
      };
    });

    const mappedDelivery = [];
    const isApprovedList = statusKey === 'approved';
    const isAwaitingList = statusKey === 'awaiting_approval' || statusKey === 'pending';
    if (shouldGroupDelivery && deliveryDocs.length > 0) {
      const groups = new Map();
      for (const doc of deliveryDocs) {
        const timeKey = toISTDateTimeLabelNoComma(doc.createdAt) || '';
        const keyParts = [
          normalizeString(doc.guestPhoneDigits || doc.guestPhoneNumber || '').toLowerCase(),
          normalizeString(doc.guestName || '').toLowerCase(),
          normalizeString(doc.visitorCompanyName || '').toLowerCase(),
          String(doc.createdByGuardId || ''),
          String(doc.gateId || ''),
          timeKey,
        ];
        const key = keyParts.join('|');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(doc);
      }

      for (const groupDocs of groups.values()) {
        const approved = groupDocs.filter((d) => d.status === 'approved' || d.status === 'entered');
        const notApproved = groupDocs.filter((d) => !(d.status === 'approved' || d.status === 'entered'));
        const hasAnyApproved = approved.length > 0;
        const hasAnyNotApproved = notApproved.length > 0;
        const isPartialApproval = hasAnyApproved && hasAnyNotApproved;

        // Helper to build approvedFor array with approver details
        const buildApprovedFor = (docs) =>
          docs.map((d) => ({
            requestId: d.requestId,
            wingName: d.wingName,
            unitNumber: d.unitNumber,
            approvedBy: d.approvedByGuardWithoutMemberResponse && d.approvedByGuardId
              ? (() => {
                  const guard = guardApproverById.get(String(d.approvedByGuardId));
                  return guard
                    ? {
                        id: String(guard._id),
                        name: guard.fullName ? `${guard.fullName} (Security Guard)` : 'Security Guard',
                        countryCode: guard.countryCode || '+91',
                        phoneNumber: guard.phoneNumber || null,
                        isGuard: true,
                      }
                    : '';
                })()
              : d.approvedByUserId
                ? (() => {
                    const user = approverById.get(String(d.approvedByUserId));
                    return user
                      ? {
                          id: String(user._id),
                          name: user.fullName || null,
                          countryCode: user.countryCode || '+91',
                          phoneNumber: user.phoneNumber || null,
                          isGuard: false,
                        }
                      : '';
                  })()
                : '',
            approvedOn: d.approvedByGuardWithoutMemberResponse && d.approvedByGuardAt
              ? toISTDateTimeLabel(d.approvedByGuardAt)
              : d.approvedAt
                ? toISTDateTimeLabel(d.approvedAt)
                : '',
          }));

        if (isApprovedList) {
          // Include if at least one unit is approved (full or partial approval)
          if (!hasAnyApproved) {
            continue;
          }

          const primaryDoc = groupDocs.reduce(
            (latest, d) => (!latest || new Date(d.createdAt).getTime() > new Date(latest.createdAt).getTime() ? d : latest),
            null
          );
          const approvedByUser = primaryDoc?.approvedByUserId ? approverById.get(String(primaryDoc.approvedByUserId)) : null;
          const approvedByGuard = primaryDoc?.approvedByGuardWithoutMemberResponse && primaryDoc?.approvedByGuardId
            ? guardApproverById.get(String(primaryDoc.approvedByGuardId))
            : null;
          const companyLogo = resolveCompanyLogo({
            visitorType: primaryDoc?.visitorType,
            companyName: primaryDoc?.visitorCompanyName,
            deliveryCompanyLogos,
          });
          const payload = primaryDoc
            ? toGuardCardPayload({ reqDoc: primaryDoc, approvedByUser, approvedByGuard, companyLogo })
            : null;
          if (payload) {
            // Partial approval: some approved, some not
            const statusLabel = isPartialApproval ? 'Partial Approved' : 'Approved';
            const statusKeyValue = isPartialApproval ? 'partial_approved' : 'approved';

            mappedDelivery.push({
              ...payload,
              status: statusLabel,
              statusKey: statusKeyValue,
              visitorTypeKey: primaryDoc.visitorType || 'guest',
              approvedBy: null,
              approvedOn: null,
              unit: null,
              approvedFor: buildApprovedFor(approved),
              notApprovedFor: notApproved.map((d) => ({
                requestId: d.requestId,
                wingName: d.wingName,
                unitNumber: d.unitNumber,
              })),
              _sortTime: primaryDoc.createdAt ? new Date(primaryDoc.createdAt).getTime() : 0,
            });
          }
          continue;
        }

        if (isAwaitingList) {
          // Do NOT include if ANY unit is approved (partial approvals go to approved list)
          if (hasAnyApproved) {
            continue;
          }

          // Only pending/not-approved docs remain
          if (groupDocs.length === 1) {
            const doc = groupDocs[0];
            if (doc.status !== 'pending') {
              continue;
            }
            const approvedByUser = doc.approvedByUserId ? approverById.get(String(doc.approvedByUserId)) : null;
            const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
              ? guardApproverById.get(String(doc.approvedByGuardId))
              : null;
            const companyLogo = resolveCompanyLogo({
              visitorType: doc.visitorType,
              companyName: doc.visitorCompanyName,
              deliveryCompanyLogos,
            });
            const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
            mappedDelivery.push({
              ...payload,
              statusKey: doc.status,
              visitorTypeKey: doc.visitorType || 'guest',
              _sortTime: doc.createdAt ? new Date(doc.createdAt).getTime() : 0,
            });
            continue;
          }

          // Multiple units, all pending (no approved)
          const primaryDoc = groupDocs.reduce(
            (latest, d) => (!latest || new Date(d.createdAt).getTime() > new Date(latest.createdAt).getTime() ? d : latest),
            null
          );
          const approvedByUser = primaryDoc?.approvedByUserId ? approverById.get(String(primaryDoc.approvedByUserId)) : null;
          const approvedByGuard = primaryDoc?.approvedByGuardWithoutMemberResponse && primaryDoc?.approvedByGuardId
            ? guardApproverById.get(String(primaryDoc.approvedByGuardId))
            : null;
          const companyLogo = resolveCompanyLogo({
            visitorType: primaryDoc?.visitorType,
            companyName: primaryDoc?.visitorCompanyName,
            deliveryCompanyLogos,
          });
          const payload = primaryDoc
            ? toGuardCardPayload({ reqDoc: primaryDoc, approvedByUser, approvedByGuard, companyLogo })
            : null;
          if (payload) {
            mappedDelivery.push({
              ...payload,
              status: 'Awaiting Approval',
              statusKey: 'pending',
              visitorTypeKey: primaryDoc.visitorType || 'guest',
              approvedBy: '',
              approvedOn: '',
              unit: null,
              approvedFor: [],
              notApprovedFor: notApproved.map((d) => ({
                requestId: d.requestId,
                wingName: d.wingName,
                unitNumber: d.unitNumber,
              })),
              _sortTime: primaryDoc.createdAt ? new Date(primaryDoc.createdAt).getTime() : 0,
            });
          }
        }
      }
    }

    const mapped = [...mappedOthers, ...mappedDelivery]
      .sort((a, b) => (b._sortTime || 0) - (a._sortTime || 0))
      .slice(0, 100)
      .map((entry) => {
        const { _sortTime, ...rest } = entry;
        return rest;
      });

    return sendSuccessResponse(res, 200, 'Guest entry requests fetched successfully', {
      data: mapped,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guest entry requests'));
  }
};

const createGuestEntryRequest = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const wingName = normalizeString(req.body?.wingName ?? req.body?.wing);
    const unitNumberRaw = req.body?.unitNumber ?? req.body?.unit;
    const unitNumbers = Array.isArray(unitNumberRaw)
      ? unitNumberRaw.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    const unitNumber = Array.isArray(unitNumberRaw) ? null : normalizeString(unitNumberRaw);
    const guestName = normalizeString(req.body?.guestName ?? req.body?.fullName ?? req.body?.name);
    const phoneRaw = normalizeString(req.body?.phoneNumber ?? req.body?.mobileNumber ?? req.body?.mobile);
    const countryCode = normalizeCountryCode(req.body?.countryCode || '+91');
    const imageUrl = normalizeString(req.body?.imageUrl) || null;
    const companyNameRaw = normalizeString(
      req.body?.deliveryCompanyName ?? req.body?.companyName ?? req.body?.visitorCompanyName
    );
    const workCategoryRaw = normalizeString(req.body?.workCategory ?? req.body?.visitorWorkCategory);
    const visitorTypeRaw = normalizeString(
      req.body?.visitorType ?? req.body?.visitorTypeKey ?? req.body?.visitorCategory ?? req.body?.category
    );

    const accompanyingCountRaw =
      req.body?.accompanyingCount ?? req.body?.accompanyingPerson ?? req.body?.accompanyingPersons;
    const accompanyingCountNumber = Number(accompanyingCountRaw);
    const accompanyingCount = Number.isFinite(accompanyingCountNumber) && accompanyingCountNumber > 0 ? accompanyingCountNumber : 0;

    const vehicleNumber = normalizeString(req.body?.vehicleNumber).toUpperCase() || null;

    if (!wingName) return next(createHttpError('wingName is required', 400));
    if (unitNumbers.length === 0 && !unitNumber) {
      return next(createHttpError('unitNumber is required', 400));
    }
    if (!guestName) return next(createHttpError('guestName is required', 400));
    if (!phoneRaw) return next(createHttpError('phoneNumber is required', 400));
    if (!isTenDigitPhone(phoneRaw)) return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));

    let visitorType = (visitorTypeRaw || '').toLowerCase().replace(/\s+/g, '_') || 'guest';
    if (!visitorTypeRaw && companyNameRaw) visitorType = 'delivery_executive';
    if (!VISITOR_TYPES.includes(visitorType)) {
      return next(createHttpError('visitorType is invalid', 400));
    }
    if (unitNumbers.length > 0 && visitorType !== 'delivery_executive') {
      return next(
        createHttpError('Multiple units are only supported for delivery executive', 400)
      );
    }
    if (visitorType === 'delivery_executive' && !companyNameRaw) {
      return next(createHttpError('deliveryCompanyName is required for delivery executive', 400));
    }
    if (visitorType === 'taxi_vehicle_driver' && !companyNameRaw) {
      return next(createHttpError('companyName is required for taxi vehicle driver', 400));
    }
    if (visitorType === 'other_visitor' && !workCategoryRaw) {
      return next(createHttpError('workCategory is required for other visitor', 400));
    }
    if (visitorType === 'other_visitor' && !companyNameRaw) {
      return next(createHttpError('companyName is required for other visitor', 400));
    }

    let companyName = companyNameRaw;
    if (visitorType === 'taxi_vehicle_driver' && companyName) {
      const matchedTaxiCompany = await resolveTaxiCompanyName(companyName);
      if (!matchedTaxiCompany) {
        return next(
          createHttpError('Taxi company must match a registered taxi company', 400)
        );
      }
      companyName = matchedTaxiCompany;
    }

    const unitsToProcess = unitNumbers.length > 0 ? unitNumbers : [unitNumber];
    const phoneDigits = normalizePhoneDigits(phoneRaw);

    
    const alreadyInsideEntry = await checkVisitorAlreadyInside({
      societyId: activeDuty.societyId,
      phoneDigits,
    });
    if (alreadyInsideEntry) {
      return next(
        createHttpError(
          `This visitor is already inside the society (Entry: ${alreadyInsideEntry.requestId}). Please mark exit first.`,
          409
        )
      );
    }

    const existingPhoto = await resolveExistingVisitorPhoto({ phoneDigits, visitorType });
    const finalImageUrl = existingPhoto || imageUrl || null;
    const photoRequired = !finalImageUrl;

    if (photoRequired) {
      const draft = await GuestEntryRequestDraft.create({
        societyId: activeDuty.societyId,
        createdByGuardId: authUser._id,
        gateId: activeDuty.dutyGateId || null,
        gateName: activeDuty.dutyGateName || null,
        wingName,
        unitNumbers: unitsToProcess,
        guestName,
        guestCountryCode: countryCode || '+91',
        guestPhoneNumber: phoneDigits,
        guestPhoneDigits: phoneDigits,
        visitorType,
        visitorCompanyName: companyName || null,
        visitorWorkCategory: workCategoryRaw || null,
        accompanyingCount,
        vehicleNumber,
      });

      const labels = toVisitorLabels(visitorType);
      return sendSuccessResponse(res, 200, 'Photo required before creating request', {
        data: {
          requestCreated: false,
          requestId: draft.requestId,
          status: 'Awaiting Approval',
          category: labels.category,
          visitorType: labels.visitorType,
          photoRequired: true,
          guest: {
            name: guestName,
            countryCode: countryCode || '+91',
            phoneNumber: phoneDigits,
            imageUrl: null,
            companyName: companyName || null,
            workCategory: workCategoryRaw || null,
          },
          accompanyingCount: String(accompanyingCount || 0),
          vehicleNumber: vehicleNumber || null,
          ...(unitsToProcess.length === 1
            ? { unit: { wingName, unitNumber: unitsToProcess[0] } }
            : { units: unitsToProcess.map((u) => ({ wingName, unitNumber: u })) }),
        },
      });
    }
    const recipientsByUnit = new Map();
    const missingUnits = [];

    for (const targetUnit of unitsToProcess) {
      const recipientUserIds = await resolveUnitResidents({
        societyId: activeDuty.societyId,
        wingNameLower: wingName.toLowerCase(),
        unitNumberLower: targetUnit.toLowerCase(),
      });

      if (!recipientUserIds || recipientUserIds.length === 0) {
        missingUnits.push(targetUnit);
      } else {
        recipientsByUnit.set(targetUnit, recipientUserIds);
      }
    }

    if (missingUnits.length > 0) {
      return next(
        createHttpError(
          `No residents found for units: ${missingUnits.join(', ')}. Cannot send approval request.`,
          404
        )
      );
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const now = new Date();
    const unitNumberLowers = unitsToProcess.map((u) => u.toLowerCase());
    const unitDocs = await MemberUnit.find(
      {
        societyId: activeDuty.societyId,
        wingNameLower: wingName.toLowerCase(),
        unitNumberLower: { $in: unitNumberLowers },
        $or: [
          { occupancyStatus: 'currently_residing' },
          { occupancyStatus: 'unit_rented', occupantType: { $in: ['tenant', 'tenant_family_member'] } },
        ],
      },
      { _id: 1, unitNumberLower: 1 }
    ).lean();
    const unitByNumber = new Map();
    for (const unit of unitDocs || []) {
      const key = unit.unitNumberLower;
      if (key && !unitByNumber.has(key)) {
        unitByNumber.set(key, unit);
      }
    }

    const createdDocs = await Promise.all(
      unitsToProcess.map(async (targetUnit) => {
        const unitKey = targetUnit.toLowerCase();
        const unitDoc = unitByNumber.get(unitKey);
        const preApproval = unitDoc
          ? await resolvePreApprovalForUnit({
              visitorType,
              societyId: activeDuty.societyId,
              unitId: unitDoc._id,
              companyName,
              workCategory: workCategoryRaw,
              vehicleNumber,
              guestName,
              phoneDigits,
              now,
            })
          : null;
        const autoApproved = Boolean(preApproval);

        return GuestEntryRequest.create({
          societyId: activeDuty.societyId,
          wingName,
          wingNameLower: wingName.toLowerCase(),
          unitNumber: targetUnit,
          unitNumberLower: unitKey,
          createdByGuardId: authUser._id,
          gateId: activeDuty.dutyGateId || null,
          gateName: activeDuty.dutyGateName || null,
          guestName,
          guestCountryCode: countryCode || '+91',
          guestPhoneNumber: phoneDigits,
          guestPhoneDigits: phoneDigits,
          guestImageUrl: finalImageUrl,
          visitorType,
          visitorCompanyName: companyName || null,
          visitorWorkCategory: workCategoryRaw || null,
          accompanyingCount,
          vehicleNumber,
          status: autoApproved ? 'approved' : 'pending',
          approvedByUserId: autoApproved ? preApproval.invitedByUserId : null,
          approvedAt: autoApproved ? now : null,
          expiresAt: autoApproved ? null : expiresAt,
          recipientUserIds: recipientsByUnit.get(targetUnit),
        });
      })
    );

    const labels = toVisitorLabels(visitorType);

    const primaryDoc = createdDocs[0];
    const basePayload = {
      status: getStatusLabel(primaryDoc.status),
      category: labels.category,
      visitorType: labels.visitorType,
      photoRequired,
      requestsendat: primaryDoc.createdAt ? toISTDateTimeLabel(primaryDoc.createdAt) : null,
      expiresAt: primaryDoc.expiresAt ? toISTDateTimeLabel(primaryDoc.expiresAt) : null,
      guest: {
        name: primaryDoc.guestName,
        countryCode: primaryDoc.guestCountryCode || '+91',
        phoneNumber: primaryDoc.guestPhoneNumber,
        imageUrl: primaryDoc.guestImageUrl || null,
        companyName: primaryDoc.visitorCompanyName || null,
        workCategory: primaryDoc.visitorWorkCategory || null,
      },
      accompanyingCount: String(primaryDoc.accompanyingCount || 0),
      vehicleNumber: primaryDoc.vehicleNumber || null,
    };

    
    for (const doc of createdDocs) {
      if (doc.status === 'pending' && doc.recipientUserIds && doc.recipientUserIds.length > 0) {
        const notification = getNotificationContent(doc, 'approval');
        sendToUsers(
          doc.recipientUserIds,
          notification.title,
          notification.body,
          {
            type: 'guest_entry_request',
            requestId: doc.requestId,
            visitorType: doc.visitorType || 'guest',
            status: 'pending',
          }
        ).catch((err) => {
          console.error('[GuestEntryRequest] Failed to send push notification:', err.message);
        });
      }
    }

    if (createdDocs.length === 1) {
      return sendSuccessResponse(res, 201, 'Guest approval request created successfully', {
        data: {
          ...basePayload,
          requestId: primaryDoc.requestId,
          unit: { wingName: primaryDoc.wingName, unitNumber: primaryDoc.unitNumber },
        },
      });
    }

    return sendSuccessResponse(res, 201, 'Guest approval requests created successfully', {
      data: {
        ...basePayload,
        requestIds: createdDocs.map((d) => d.requestId),
        units: createdDocs.map((d) => ({ wingName: d.wingName, unitNumber: d.unitNumber })),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create guest entry request'));
  }
};


const getGuestEntryRequestForGuard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const requestId = normalizeString(req.body?.requestId || req.query?.requestId || req.params?.requestId);
    const requestIdsRaw = req.query?.requestIds ?? req.body?.requestIds;

    const requestIds =
      Array.isArray(requestIdsRaw)
        ? requestIdsRaw.map((x) => normalizeString(x)).filter(Boolean)
        : typeof requestIdsRaw === 'string'
          ? requestIdsRaw
              .split(',')
              .map((x) => normalizeString(x))
              .filter(Boolean)
          : [];

    if (!requestId && requestIds.length === 0) return next(createHttpError('requestId is required', 400));

    
    if (!requestId && requestIds.length > 0) {
      const docs = await GuestEntryRequest.find({ requestId: { $in: requestIds } });
      if (!docs || docs.length === 0) return next(createHttpError('Request not found', 404));

      const filtered = docs.filter((d) => String(d.societyId) === String(activeDuty.societyId));
      if (filtered.length === 0) return next(createHttpError('Request does not belong to this society', 403));

      
      const nowMs = Date.now();
      const toSave = [];
      for (const d of filtered) {
        if (d.status === 'pending' && d.expiresAt && d.expiresAt.getTime() <= nowMs) {
          d.status = 'expired';
          toSave.push(d.save());
        }
      }
      if (toSave.length > 0) await Promise.allSettled(toSave);

      const refreshed = await GuestEntryRequest.find({ requestId: { $in: requestIds } }).lean();
      const sameSociety = refreshed.filter((d) => String(d.societyId) === String(activeDuty.societyId));

      const first = sameSociety[0];
      const labels = toVisitorLabels(first?.visitorType || 'guest');

      const approved = sameSociety.filter((d) => d.status === 'approved' || d.status === 'entered');
      const notApproved = sameSociety.filter((d) => !(d.status === 'approved' || d.status === 'entered'));

      const overallStatus =
        approved.length === 0
          ? 'Awaiting Approval'
          : notApproved.length === 0
            ? approved.some((d) => d.status === 'entered')
              ? 'Inside Society'
              : 'Approved'
            : 'Partial Approved';

      const payload = {
        requestIds: sameSociety.map((d) => d.requestId),
        category: labels.category,
        visitorType: labels.visitorType,
        status: overallStatus,
        name: first?.guestName || null,
        phone: {
          countryCode: first?.guestCountryCode || '+91',
          phoneNumber: first?.guestPhoneNumber || null,
        },
        accompanyingPerson: first?.accompanyingCount || 0,
        vehicleNumber: first?.vehicleNumber || null,
        imageUrl: first?.guestImageUrl || null,
        approvedFor: approved.map((d) => ({ wingName: d.wingName, unitNumber: d.unitNumber })),
        notApprovedFor: notApproved.map((d) => ({ wingName: d.wingName, unitNumber: d.unitNumber })),
        requests: await Promise.all(
          sameSociety.map(async (d) => {
            const approvedByUser = d.approvedByUserId ? await User.findById(d.approvedByUserId).lean() : null;
            const approvedByGuard = d.approvedByGuardWithoutMemberResponse && d.approvedByGuardId
              ? await User.findById(d.approvedByGuardId).lean()
              : null;
            const companyLogo = await resolveCompanyLogoForRequest({
              visitorType: d.visitorType,
              companyName: d.visitorCompanyName,
            });
            return toGuardCardPayload({ reqDoc: d, approvedByUser, approvedByGuard, companyLogo });
          })
        ),
      };

      return sendSuccessResponse(res, 200, 'Entry requests fetched successfully', { data: payload });
    }

    
    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (String(doc.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Request does not belong to this society', 403));
    }

    if (doc.status === 'pending' && doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      doc.status = 'expired';
      await doc.save();
    }

    const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
    const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
      ? await User.findById(doc.approvedByGuardId).lean()
      : null;
    const companyLogo = await resolveCompanyLogoForRequest({
      visitorType: doc.visitorType,
      companyName: doc.visitorCompanyName,
    });
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });

    return sendSuccessResponse(res, 200, 'Guest entry request fetched successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guest entry request'));
  }
};


const listGuestEntryRequestsForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can perform this action', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    if (!unitId) return next(createHttpError('unitId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }


    const statusRaw = normalizeString(req.body?.status || 'all').toLowerCase();
    const dateFilter = normalizeOption(req.body?.dateFilter ?? req.body?.range ?? req.body?.period ?? '');
    let startAt = null;
    let endAt = null;
    const now = new Date();

    if (dateFilter) {
      if (dateFilter === 'today') {
        startAt = new Date(now);
        startAt.setHours(0, 0, 0, 0);
        endAt = new Date(now);
        endAt.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'this_month' || dateFilter === 'thismonth') {
        startAt = new Date(now.getFullYear(), now.getMonth(), 1);
        endAt = now;
      } else if (
        dateFilter === 'past_3_months' ||
        dateFilter === 'past_3_month' ||
        dateFilter === 'past3months' ||
        dateFilter === 'past3month' ||
        dateFilter === 'last_3_months' ||
        dateFilter === 'last3months' ||
        dateFilter === 'past_90_days' ||
        dateFilter === 'last_90_days'
      ) {
        startAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        startAt.setHours(0, 0, 0, 0);
        endAt = now;
      }
    }
    const status = ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'entered', 'left', 'all'].includes(
      statusRaw
    )
      ? statusRaw
      : 'pending';

    const listQuery = {
      societyId: unitDoc.societyId,
      wingNameLower: unitDoc.wingNameLower,
      unitNumberLower: unitDoc.unitNumberLower,
      ...(status === 'all' ? {} : { status }),
    };
    if (startAt || endAt) {
      listQuery.createdAt = {};
      if (startAt) listQuery.createdAt.$gte = startAt;
      if (endAt) listQuery.createdAt.$lte = endAt;
    }

    const items = await GuestEntryRequest.find(
      listQuery,
      {
        requestId: 1,
        visitorType: 1,
        visitorCompanyName: 1,
        visitorWorkCategory: 1,
        guestName: 1,
        guestCountryCode: 1,
        guestPhoneNumber: 1,
        guestPhoneDigits: 1,
        guestImageUrl: 1,
        accompanyingCount: 1,
        vehicleNumber: 1,
        status: 1,
        createdAt: 1,
        expiresAt: 1,
        approvedByUserId: 1,
        entryAllowedAt: 1,
        entryLeftAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const deliveryCompanyNames = Array.from(
      new Set(
        (items || [])
          .filter((d) => d.visitorType === 'delivery_executive')
          .map((d) => normalizeString(d.visitorCompanyName).toLowerCase())
          .filter(Boolean)
      )
    );

    const deliveryCompanies = deliveryCompanyNames.length
      ? await DeliveryCompany.find(
          { name: { $in: deliveryCompanyNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, 'i')) } },
          { name: 1, imageUrl: 1 }
        ).lean()
      : [];

    const deliveryCompanyLogos = new Map(
      deliveryCompanies
        .map((company) => [normalizeString(company.name).toLowerCase(), company.imageUrl || null])
        .filter(([, imageUrl]) => Boolean(imageUrl))
    );

    const toStatusLabel = (key, doc) => {
      if (key === 'approved') {
        // Distinguish pre-approved (auto at creation) vs manually approved (later)
        const createdMs = doc.createdAt ? new Date(doc.createdAt).getTime() : 0;
        const approvedMs = doc.approvedAt ? new Date(doc.approvedAt).getTime() : 0;
        const isAutoApproved = approvedMs > 0 && Math.abs(approvedMs - createdMs) < 5000;
        return isAutoApproved ? 'Pre Approved' : 'Approved';
      }
      return key === 'rejected'
        ? 'Entry Denied'
        : key === 'entered'
          ? 'Inside Society'
          : key === 'left'
            ? 'Left Society'
            : key === 'expired'
              ? 'Expired'
              : key === 'cancelled'
                ? 'Cancelled'
                : key === 'wrong_entry'
                  ? 'Wrong Entry'
                  : 'Awaiting Approval';
    };

    const mapped = (items || []).map((d) => {
      const statusLabel = toStatusLabel(d.status, d);
      const labels = toVisitorLabels(d.visitorType || 'guest');
      const companyLogo = resolveCompanyLogo({
        visitorType: d.visitorType,
        companyName: d.visitorCompanyName,
        deliveryCompanyLogos,
      });
      return {
        requestId: d.requestId,
        status: statusLabel,
        statusKey: d.status,
        category: labels.category,
        visitorType: labels.visitorType,
        requestedOn: d.createdAt ? toISTDateTimeLabel(d.createdAt) : null,
        unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
        guest: {
          name: d.guestName,
          countryCode: d.guestCountryCode || '+91',
          phoneNumber: d.guestPhoneNumber,
          imageUrl: d.guestImageUrl || null,
          companyName: d.visitorCompanyName || null,
          workCategory: d.visitorWorkCategory || null,
          companyLogo,
        },
        accompanyingCount: String(d.accompanyingCount || 0),
        vehicleNumber: d.vehicleNumber || null,
        entryAt: d.entryAllowedAt ? toISTDateTimeLabel(d.entryAllowedAt) : null,
        leftAt: d.entryLeftAt ? toISTDateTimeLabel(d.entryLeftAt) : null,

      };
    });

    const preApprovalStatusFilter =
      status === 'approved'
        ? ['active']
        : status === 'expired'
          ? ['expired', 'active']
          : status === 'cancelled'
            ? ['cancelled']
            : status === 'all' || status === 'pending'
              ? ['active', 'expired', 'cancelled']
              : [];

    const normalizedText = (value) => normalizeString(value).toLowerCase();
    const normalizedVehicle = (value) => normalizeString(value).toUpperCase();
    const normalizedDigits = (value) => normalizeString(value);

    const entryIndex = (items || []).map((d) => ({
      visitorType: d.visitorType || 'guest',
      status: d.status,
      companyName: normalizedText(d.visitorCompanyName),
      workCategory: normalizedText(d.visitorWorkCategory),
      vehicleNumber: normalizedVehicle(d.vehicleNumber),
      guestName: normalizedText(d.guestName),
      guestPhoneDigits: normalizedDigits(d.guestPhoneDigits || d.guestPhoneNumber),
      approvedByUserId: d.approvedByUserId ? String(d.approvedByUserId) : null,
      createdAtMs: d.createdAt ? new Date(d.createdAt).getTime() : null,
    }));

    const hasMatchingEntry = (preDoc, visitorType) => {
      const fromMs = preDoc.validFrom ? new Date(preDoc.validFrom).getTime() : null;
      const tillMs = preDoc.validTill ? new Date(preDoc.validTill).getTime() : null;
      const preCompany = normalizedText(preDoc.companyName);
      const preWork = normalizedText(preDoc.workCategory);
      const preVehicle = normalizedVehicle(preDoc.vehicleNumber);
      const invitedBy = preDoc.invitedByUserId ? String(preDoc.invitedByUserId) : null;

      return entryIndex.some((entry) => {
        if (entry.visitorType !== visitorType) return false;
        if (!['approved', 'entered', 'left', 'wrong_entry', 'cancelled'].includes(entry.status)) return false;
        if (invitedBy && entry.approvedByUserId && invitedBy !== entry.approvedByUserId) return false;
        if (fromMs && tillMs && entry.createdAtMs) {
          if (entry.createdAtMs < fromMs || entry.createdAtMs > tillMs) return false;
        }

        if (visitorType === 'delivery_executive') {
          if (preCompany && preCompany !== entry.companyName) return false;
        } else if (visitorType === 'taxi_vehicle_driver') {
          if (preCompany && preCompany !== entry.companyName) return false;
          if (preVehicle && preVehicle !== entry.vehicleNumber) return false;
        } else if (visitorType === 'other_visitor') {
          if (preCompany && preCompany !== entry.companyName) return false;
          if (preWork && preWork !== entry.workCategory) return false;
        }

        return true;
      });
    };

    const preApprovalDateQuery = {};
    if (startAt || endAt) {
      preApprovalDateQuery.validFrom = {};
      if (startAt) preApprovalDateQuery.validFrom.$gte = startAt;
      if (endAt) preApprovalDateQuery.validFrom.$lte = endAt;
    }

    let preApprovalCards = [];
    if (preApprovalStatusFilter.length > 0) {
      const [deliveryApprovals, taxiApprovals, otherApprovals] = await Promise.all([
        DeliveryPreApproval.find(
          {
            societyId: unitDoc.societyId,
            unitId: unitDoc._id,
            status: { $in: preApprovalStatusFilter },
            ...preApprovalDateQuery,
          },
          {
            preApprovalId: 1,
            visitorType: 1,
            visitorName: 1,
            companyName: 1,
            companyImageUrl: 1,
            isSilentDelivery: 1,
            validFrom: 1,
            validTill: 1,
            status: 1,
            createdAt: 1,
            invitedByUserId: 1,
          }
        ).lean(),
        TaxiDriverPreApproval.find(
          {
            societyId: unitDoc.societyId,
            unitId: unitDoc._id,
            status: { $in: preApprovalStatusFilter },
            ...preApprovalDateQuery,
          },
          {
            preApprovalId: 1,
            visitorType: 1,
            visitorName: 1,
            companyName: 1,
            companyImageUrl: 1,
            vehicleNumber: 1,
            isPrivateInvite: 1,
            validFrom: 1,
            validTill: 1,
            status: 1,
            createdAt: 1,
            invitedByUserId: 1,
          }
        ).lean(),
        OtherVisitorPreApproval.find(
          {
            societyId: unitDoc.societyId,
            unitId: unitDoc._id,
            status: { $in: preApprovalStatusFilter },
            ...preApprovalDateQuery,
          },
          {
            preApprovalId: 1,
            visitorType: 1,
            visitorName: 1,
            workCategory: 1,
            companyName: 1,
            isPrivateInvite: 1,
            validFrom: 1,
            validTill: 1,
            status: 1,
            createdAt: 1,
            invitedByUserId: 1,
          }
        ).lean(),
      ]);

      const mapPreApproval = (doc) => {
        const labels = toVisitorLabels(doc.visitorType || 'guest');
        const effectiveStatus = resolveActiveStatus(doc.status, doc.validTill, now);
        const statusKey = effectiveStatus === 'active' ? 'approved' : effectiveStatus;
        const statusLabel =
          effectiveStatus === 'active'
            ? 'Pre Approved'
            : effectiveStatus === 'expired'
              ? 'Expired'
              : 'Cancelled';
        const fromLabel = toISTDateTimeLabelNoComma(doc.validFrom);
        const tillLabel = toISTDateTimeLabelNoComma(doc.validTill);
        const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;
        const displayName = doc.visitorName || null;
        const preApprovalLogo =
          normalizeString(doc.companyImageUrl) ||
          resolveCompanyLogo({
            visitorType: doc.visitorType,
            companyName: doc.companyName,
            deliveryCompanyLogos,
          });

        return {
          requestId: doc.preApprovalId,
          status: statusLabel,
          statusKey,
          category: labels.category,
          visitorType: labels.visitorType,
          requestedOn: doc.validFrom ? toISTDateTimeLabel(doc.validFrom) : null,
          guest: {
            name: displayName,
            imageUrl: normalizeString(doc.companyImageUrl) || null,
            companyName: doc.companyName || null,
            workCategory: doc.workCategory || null,
            companyLogo: preApprovalLogo || null,
          },
          validityLabel,
          isPreApproval: true,
          isSilentDelivery: doc.visitorType === 'delivery_executive' ? Boolean(doc.isSilentDelivery) : null,
          isPrivateInvite:
            doc.visitorType === 'taxi_vehicle_driver' || doc.visitorType === 'other_visitor'
              ? Boolean(doc.isPrivateInvite)
              : null,
          _sortAt: doc.createdAt || doc.validFrom || doc.validTill || null,
        };
      };

      preApprovalCards = [
        ...deliveryApprovals.filter((doc) => !hasMatchingEntry(doc, 'delivery_executive')),
        ...taxiApprovals.filter((doc) => !hasMatchingEntry(doc, 'taxi_vehicle_driver')),
        ...otherApprovals.filter((doc) => !hasMatchingEntry(doc, 'other_visitor')),
      ].map(mapPreApproval);

      if (status === 'expired') {
        preApprovalCards = preApprovalCards.filter((card) => card.statusKey === 'expired');
      } else if (status === 'approved') {
        preApprovalCards = preApprovalCards.filter((card) => card.statusKey === 'approved');
      } else if (status === 'cancelled') {
        preApprovalCards = preApprovalCards.filter((card) => card.statusKey === 'cancelled');
      }
    }

    let guestInviteCards = [];
    if (preApprovalStatusFilter.length > 0) {
      const guestInvites = await GuestInvite.find(
        {
          societyId: unitDoc.societyId,
          unitId: unitDoc._id,
          status: { $in: preApprovalStatusFilter },
          ...preApprovalDateQuery,
        },
        {
          inviteId: 1,
          type: 1,
          guests: 1,
          entryLogs: 1,
          validFrom: 1,
          validTill: 1,
          status: 1,
          createdAt: 1,
          invitedByUserId: 1,
          isPrivateInvite: 1,
        }
      ).lean();

      const hasMatchingGuestInvite = (invite, guest) => {
        const fromMs = invite.validFrom ? new Date(invite.validFrom).getTime() : null;
        const tillMs = invite.validTill ? new Date(invite.validTill).getTime() : null;
        const guestName = normalizedText(guest?.name);
        const guestPhone = normalizedDigits(guest?.phoneDigits || guest?.phoneNumber);
        const invitedBy = invite.invitedByUserId ? String(invite.invitedByUserId) : null;

        return entryIndex.some((entry) => {
          if (entry.visitorType !== 'guest') return false;
          if (!['approved', 'entered', 'left', 'wrong_entry', 'cancelled'].includes(entry.status)) return false;
          if (invitedBy && entry.approvedByUserId && invitedBy !== entry.approvedByUserId) return false;
          if (fromMs && tillMs && entry.createdAtMs) {
            if (entry.createdAtMs < fromMs || entry.createdAtMs > tillMs) return false;
          }
          if (guestPhone && entry.guestPhoneDigits) {
            return guestPhone === entry.guestPhoneDigits;
          }
          if (guestName && entry.guestName) {
            return guestName === entry.guestName;
          }
          return false;
        });
      };

      const mapGuestInvite = (invite, guest) => {
        const effectiveStatus = resolveActiveStatus(invite.status, invite.validTill, now);
        const statusKey = effectiveStatus === 'active' ? 'approved' : effectiveStatus;
        const statusLabel =
          effectiveStatus === 'active'
            ? 'Pre Approved'
            : effectiveStatus === 'expired'
              ? 'Expired'
              : 'Cancelled';
        const fromLabel = toISTDateTimeLabelNoComma(invite.validFrom);
        const tillLabel = toISTDateTimeLabelNoComma(invite.validTill);
        const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;

        
        let guestImageUrl = null;
        if (guest?.guestId && Array.isArray(invite.entryLogs)) {
          const entryLog = invite.entryLogs.find((log) => log.guestId === guest.guestId);
          if (entryLog?.imageUrl) {
            guestImageUrl = entryLog.imageUrl;
          }
        }

        return {
          requestId: invite.inviteId,
          status: statusLabel,
          statusKey,
          category: VISITOR_TYPE_LABELS.guest.category,
          visitorType: VISITOR_TYPE_LABELS.guest.visitorType,
          requestedOn: invite.validFrom ? toISTDateTimeLabel(invite.validFrom) : null,
          guest: {
            name: guest?.name || null,
            imageUrl: guestImageUrl,
            companyLogo: null,
          },
          validityLabel,
          isPreApproval: true,
          isPrivateInvite: Boolean(invite.isPrivateInvite),
          _sortAt: invite.createdAt || invite.validFrom || invite.validTill || null,
        };
      };

      const mappedInvites = [];
      for (const invite of guestInvites || []) {
        if (invite.type === 'group') {
          const guest = Array.isArray(invite.guests) && invite.guests.length > 0 ? invite.guests[0] : null;
          if (!hasMatchingGuestInvite(invite, guest)) {
            mappedInvites.push(mapGuestInvite(invite, guest));
          }
          continue;
        }
        for (const guest of invite.guests || []) {
          if (hasMatchingGuestInvite(invite, guest)) continue;
          mappedInvites.push(mapGuestInvite(invite, guest));
        }
      }

      guestInviteCards = mappedInvites;

      if (status === 'expired') {
        guestInviteCards = guestInviteCards.filter((card) => card.statusKey === 'expired');
      } else if (status === 'approved') {
        guestInviteCards = guestInviteCards.filter((card) => card.statusKey === 'approved');
      } else if (status === 'cancelled') {
        guestInviteCards = guestInviteCards.filter((card) => card.statusKey === 'cancelled');
      }
    }

    const combined = [...mapped, ...preApprovalCards, ...guestInviteCards].sort((a, b) => {
      const aTime = a._sortAt ? new Date(a._sortAt).getTime() : 0;
      const bTime = b._sortAt ? new Date(b._sortAt).getTime() : 0;
      return bTime - aTime;
    });

    const finalPayload = combined.map((item) => {
      const { _sortAt, ...rest } = item;
      return rest;
    });
    return sendSuccessResponse(res, 200, 'Guest entry requests fetched successfully', { data: finalPayload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guest entry requests'));
  }
};

const listGuestEntryRequestsForSocietyAdmin = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId) {
      return next(createHttpError('Only society admins can perform this action', 403));
    }

    const societyId = await resolveAdminSocietyId(authUser);
    const statusKey = normalizeOption(req.body?.status ?? req.body?.statusKey ?? req.body?.statusFilter ?? 'all');
    const visitorTypeRaw = req.body?.visitorType ?? req.body?.visitorTypeKey;
    const dateFilter = normalizeOption(req.body?.dateFilter ?? req.body?.range ?? req.body?.period ?? 'today');
    const startDateRaw = req.body?.fromDate ?? req.body?.startDate ?? req.body?.from;
    const endDateRaw = req.body?.toDate ?? req.body?.endDate ?? req.body?.to;

    const visitorTypes =
      Array.isArray(visitorTypeRaw)
        ? visitorTypeRaw.map((v) => normalizeOption(v)).filter(Boolean)
        : normalizeOption(visitorTypeRaw)
          ? [normalizeOption(visitorTypeRaw)]
          : [];

    const normalizedVisitorTypes =
      visitorTypes.length > 0
        ? visitorTypes.filter((t) => VISITOR_TYPES.includes(t))
        : VISITOR_TYPES;

    if (visitorTypes.length > 0 && normalizedVisitorTypes.length === 0) {
      return next(createHttpError('visitorType is invalid', 400));
    }

    
    const ADMIN_LOG_STATUSES = ['entered', 'left'];
    const statusFilter = statusKey === 'inside_society'
      ? ['entered']
      : statusKey === 'left_society' || statusKey === 'left'
        ? ['left']
        : ADMIN_LOG_STATUSES;

    let startAt = null;
    let endAt = null;
    const now = new Date();

    if (startDateRaw || endDateRaw) {
      if (startDateRaw) {
        startAt = new Date(startDateRaw);
        if (Number.isNaN(startAt.getTime())) {
          return next(createHttpError('Invalid startDate format', 400));
        }
        startAt.setHours(0, 0, 0, 0);
      }
      if (endDateRaw) {
        endAt = new Date(endDateRaw);
        if (Number.isNaN(endAt.getTime())) {
          return next(createHttpError('Invalid endDate format', 400));
        }
        endAt.setHours(23, 59, 59, 999);
      }
    } else if (dateFilter && dateFilter !== 'all') {
      if (dateFilter === 'today') {
        startAt = new Date(now);
        startAt.setHours(0, 0, 0, 0);
        endAt = now;
      } else if (dateFilter === 'this_month' || dateFilter === 'thismonth') {
        startAt = new Date(now.getFullYear(), now.getMonth(), 1);
        endAt = now;
      } else if (
        dateFilter === 'past_3_months' ||
        dateFilter === 'past_3_month' ||
        dateFilter === 'past3months' ||
        dateFilter === 'past3month' ||
        dateFilter === 'last_3_months' ||
        dateFilter === 'last3months' ||
        dateFilter === 'past_90_days' ||
        dateFilter === 'last_90_days'
      ) {
        startAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        startAt.setHours(0, 0, 0, 0);
        endAt = now;
      }
    }

    const query = {
      societyId,
      status: { $in: statusFilter },
      visitorType: { $in: normalizedVisitorTypes },
    };
    
    if (startAt || endAt) {
      query.entryAllowedAt = {};
      if (startAt) query.entryAllowedAt.$gte = startAt;
      if (endAt) query.entryAllowedAt.$lte = endAt;
    }

    const docs = await GuestEntryRequest.find(
      query,
      {
        requestId: 1,
        visitorType: 1,
        guestName: 1,
        guestCountryCode: 1,
        guestPhoneNumber: 1,
        guestPhoneDigits: 1,
        visitorCompanyName: 1,
        visitorWorkCategory: 1,
        accompanyingCount: 1,
        vehicleNumber: 1,
        status: 1,
        wingName: 1,
        unitNumber: 1,
        createdAt: 1,
        guestImageUrl: 1,
        entryAllowedAt: 1,
        entryLeftAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const deliveryCompanyNames = Array.from(
      new Set(
        (docs || [])
          .filter((d) => d.visitorType === 'delivery_executive')
          .map((d) => normalizeString(d.visitorCompanyName).toLowerCase())
          .filter(Boolean)
      )
    );

    const deliveryCompanies = deliveryCompanyNames.length
      ? await DeliveryCompany.find(
          { name: { $in: deliveryCompanyNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, 'i')) } },
          { name: 1, imageUrl: 1 }
        ).lean()
      : [];

    const deliveryCompanyLogos = new Map(
      deliveryCompanies
        .map((company) => [normalizeString(company.name).toLowerCase(), company.imageUrl || null])
        .filter(([, imageUrl]) => Boolean(imageUrl))
    );

    const payload = (docs || []).map((doc) => {
      const companyLogo = resolveCompanyLogo({
        visitorType: doc.visitorType,
        companyName: doc.visitorCompanyName,
        deliveryCompanyLogos,
      });
      const labels = toVisitorLabels(doc.visitorType || 'guest');
      return {
        requestId: doc.requestId,
        status: getStatusLabel(doc.status),
        statusKey: doc.status,
        category: labels.category,
        visitorType: labels.visitorType,
        requestedOn: doc.createdAt ? toISTDateTimeLabel(doc.createdAt) : null,
        unit: { wingName: doc.wingName, unitNumber: doc.unitNumber },
        guest: {
          name: doc.guestName,
          countryCode: doc.guestCountryCode || '+91',
          phoneNumber: doc.guestPhoneNumber,
          imageUrl: doc.guestImageUrl || null,
          companyName: doc.visitorCompanyName || null,
          workCategory: doc.visitorWorkCategory || null,
          companyLogo,
        },
        accompanyingCount: String(doc.accompanyingCount || 0),
        vehicleNumber: doc.vehicleNumber || null,
        entryAt: doc.entryAllowedAt ? toISTDateTimeLabel(doc.entryAllowedAt) : null,
        leftAt: doc.entryLeftAt ? toISTDateTimeLabel(doc.entryLeftAt) : null,
      };
    });

    return sendSuccessResponse(res, 200, 'Visitor log fetched successfully', {
      data: payload,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch visitor log'));
  }
};

const getGuestEntryRequestDetailForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can perform this action', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    const requestId = normalizeString(req.body?.requestId || req.params?.requestId);
    const isPreApproval = Boolean(req.body?.isPreApproval);

    if (!unitId) return next(createHttpError('unitId is required', 400));
    if (!requestId) return next(createHttpError('requestId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const toMemberStatusLabel = (key, doc) => {
      if (key === 'approved') {
        // Distinguish pre-approved (auto at creation) vs manually approved (later)
        const createdMs = doc?.createdAt ? new Date(doc.createdAt).getTime() : 0;
        const approvedMs = doc?.approvedAt ? new Date(doc.approvedAt).getTime() : 0;
        const isAutoApproved = approvedMs > 0 && Math.abs(approvedMs - createdMs) < 5000;
        return isAutoApproved ? 'Pre Approved' : 'Approved';
      }
      return key === 'rejected'
        ? 'Entry Denied'
        : key === 'entered'
          ? 'Inside Society'
          : key === 'left'
            ? 'Left Society'
            : key === 'expired'
              ? 'Expired'
              : key === 'cancelled'
                ? 'Cancelled'
                : key === 'wrong_entry'
                  ? 'Wrong Entry'
                  : 'Awaiting Approval';
    };

    const preApprovalLabel = (status) =>
      status === 'active' ? 'Pre Approved' : status === 'expired' ? 'Expired' : 'Cancelled';

    if (!isPreApproval) {
      const doc = await GuestEntryRequest.findOne({ requestId }).lean();
      if (doc) {
        if (
          String(doc.societyId) !== String(unitDoc.societyId) ||
          doc.wingNameLower !== unitDoc.wingNameLower ||
          doc.unitNumberLower !== unitDoc.unitNumberLower
        ) {
          return next(createHttpError('Forbidden: request does not belong to this unit', 403));
        }

        if (doc.status === 'pending' && doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
          await GuestEntryRequest.updateOne({ _id: doc._id }, { $set: { status: 'expired' } });
          doc.status = 'expired';
        }

        const labels = toVisitorLabels(doc.visitorType || 'guest');
        const approvedByUser = doc.approvedByUserId
          ? await User.findById(doc.approvedByUserId, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
          : null;
        const deniedByUser = doc.rejectedByUserId
          ? await User.findById(doc.rejectedByUserId, {
              fullName: 1,
              countryCode: 1,
              phoneNumber: 1,
              role: 1,
            }).lean()
          : null;
        const isPreApproved = Boolean(doc.approvedByUserId && !doc.expiresAt);

        
        let exitNotifier = null;
        if (doc.entryLeftByGuardId) {
          const guard = await User.findById(doc.entryLeftByGuardId, { fullName: 1 }).lean();
          exitNotifier = guard ? { name: `${guard.fullName || 'Guard'} (Security)`, role: 'guard' } : null;
        } else if (doc.entryLeftByMemberId) {
          const guardOnDuty = await User.findOne({
            role: 'guard',
            'guardSocieties.societyId': doc.societyId,
            'guardSocieties.isOnDuty': true,
          }, { fullName: 1 }).lean();
          if (guardOnDuty) {
            exitNotifier = { name: `${guardOnDuty.fullName || 'Guard'} (Security)`, role: 'guard' };
          } else {
            const member = await User.findById(doc.entryLeftByMemberId, { fullName: 1 }).lean();
            exitNotifier = member ? { name: member.fullName || 'Member', role: 'member' } : null;
          }
        }

        
        let wrongEntryNotifier = null;
        if (doc.wrongEntryMarkedByMemberId) {
          const markedByMember = await User.findById(doc.wrongEntryMarkedByMemberId, { fullName: 1 }).lean();
          wrongEntryNotifier = markedByMember ? { name: markedByMember.fullName || 'Member' } : null;
        }

        const companyLogo = await resolveCompanyLogoForRequest({
          visitorType: doc.visitorType,
          companyName: doc.visitorCompanyName,
        });

        return sendSuccessResponse(res, 200, 'Guest entry request fetched successfully', {
          data: {
            requestId: doc.requestId,
            status: toMemberStatusLabel(doc.status, doc),
            statusKey: doc.status,
            category: labels.category,
            visitorType: labels.visitorType,
            requestedOn: doc.createdAt ? toISTDateTimeLabel(doc.createdAt) : null,
            approvedOn: doc.approvedAt ? toISTDateTimeLabel(doc.approvedAt) : null,
            expiresAt: doc.expiresAt ? toISTDateTimeLabel(doc.expiresAt) : null,
            entryAt: doc.entryAllowedAt ? toISTDateTimeLabel(doc.entryAllowedAt) : null,
            leftAt: doc.entryLeftAt ? toISTDateTimeLabel(doc.entryLeftAt) : null,
            exitNotifier,
            unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
            approvedBy: approvedByUser
              ? {
                  name: approvedByUser.fullName
                    ? isPreApproved
                      ? `${approvedByUser.fullName} (Pre Approved)`
                      : approvedByUser.fullName
                    : null,
                  countryCode: approvedByUser.countryCode || '+91',
                  phoneNumber: approvedByUser.phoneNumber || null,
                  isPreApproved,
                }
              : null,
            deniedBy:
              doc.status === 'rejected' && deniedByUser
                ? {
                    name: deniedByUser.fullName || null,
                    countryCode: deniedByUser.countryCode || '+91',
                    phoneNumber: deniedByUser.phoneNumber || null,
                    role: deniedByUser.role || 'member',
                  }
                : null,
            guest: [
              {
                name: doc.guestName,
                countryCode: doc.guestCountryCode || '+91',
                phoneNumber: doc.guestPhoneNumber,
                imageUrl: doc.guestImageUrl || null,
                companyName: doc.visitorCompanyName || null,
                companyLogo,
                workCategory: doc.visitorWorkCategory || null,
              },
            ],
            accompanyingCount: String(doc.accompanyingCount || 0),
            vehicleNumber: doc.vehicleNumber || null,
            
            isWrongEntry: doc.isWrongEntry || false,
            wrongEntryReason: doc.wrongEntryReason || null,
            wrongEntryDescription: doc.wrongEntryDescription || null,
            wrongEntryMarkedAt: doc.wrongEntryMarkedAt ? toISTDateTimeLabel(doc.wrongEntryMarkedAt) : null,
            wrongEntryNotifier,
            rejectedReason: doc.rejectedReason || null,
            rejectedDescription: doc.rejectedDescription || null,
          },
        });
      }
    }

    const [deliveryDoc, taxiDoc, otherDoc] = await Promise.all([
      DeliveryPreApproval.findOne(
        { preApprovalId: requestId, societyId: unitDoc.societyId, unitId: unitDoc._id },
        {
          preApprovalId: 1,
          visitorType: 1,
          visitorName: 1,
          companyId: 1,
          companyName: 1,
          companyImageUrl: 1,
          isSilentDelivery: 1,
          validFrom: 1,
          validTill: 1,
          status: 1,
          createdAt: 1,
          cancelledReason: 1,
          cancelledDescription: 1,
          cancelledAt: 1,
          invitedByUserId: 1,
        }
      ).lean(),
      TaxiDriverPreApproval.findOne(
        { preApprovalId: requestId, societyId: unitDoc.societyId, unitId: unitDoc._id },
        {
          preApprovalId: 1,
          visitorType: 1,
          visitorName: 1,
          companyId: 1,
          companyName: 1,
          companyImageUrl: 1,
          vehicleNumber: 1,
          isPrivateInvite: 1,
          validFrom: 1,
          validTill: 1,
          status: 1,
          createdAt: 1,
          cancelledReason: 1,
          cancelledDescription: 1,
          cancelledAt: 1,
          invitedByUserId: 1,
        }
      ).lean(),
      OtherVisitorPreApproval.findOne(
        { preApprovalId: requestId, societyId: unitDoc.societyId, unitId: unitDoc._id },
        {
          preApprovalId: 1,
          visitorType: 1,
          visitorName: 1,
          workCategory: 1,
          companyName: 1,
          isPrivateInvite: 1,
          validFrom: 1,
          validTill: 1,
          status: 1,
          createdAt: 1,
          cancelledReason: 1,
          cancelledDescription: 1,
          cancelledAt: 1,
          invitedByUserId: 1,
        }
      ).lean(),
    ]);

    const preDoc = deliveryDoc || taxiDoc || otherDoc;
    if (preDoc) {
      const effectiveStatus = resolveActiveStatus(preDoc.status, preDoc.validTill, new Date());
      const labels = toVisitorLabels(preDoc.visitorType || 'guest');
      const fromLabel = toISTDateTimeLabelNoComma(preDoc.validFrom);
      const tillLabel = toISTDateTimeLabelNoComma(preDoc.validTill);
      const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;
      const invitedByUser = preDoc.invitedByUserId
        ? await User.findById(preDoc.invitedByUserId, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
        : null;

      const companyLogo = await resolveCompanyLogoForRequest({
        visitorType: preDoc.visitorType,
        companyName: preDoc.companyName,
      });

      return sendSuccessResponse(res, 200, 'Guest entry request fetched successfully', {
        data: {
          requestId: preDoc.preApprovalId,
          status: preApprovalLabel(effectiveStatus),
          statusKey: effectiveStatus === 'active' ? 'approved' : effectiveStatus,
          category: labels.category,
          visitorType: labels.visitorType,
          requestedOn: preDoc.validFrom ? toISTDateTimeLabel(preDoc.validFrom) : null,
          validFrom: preDoc.validFrom ? toISTDateTimeLabel(preDoc.validFrom) : null,
          validTill: preDoc.validTill ? toISTDateTimeLabel(preDoc.validTill) : null,
          createdAt: preDoc.createdAt ? toISTDateTimeLabel(preDoc.createdAt) : null,
          validityLabel,
          unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
          approver: invitedByUser
            ? {
                name: invitedByUser.fullName || null,
                countryCode: invitedByUser.countryCode || '+91',
                phoneNumber: invitedByUser.phoneNumber || null,
              }
            : null,
          guest: [
            {
              name: normalizeString(preDoc.visitorName) || null,
              countryCode: null,
              phoneNumber: null,
              imageUrl: normalizeString(preDoc.companyImageUrl) || null,
              companyId: normalizeString(preDoc.companyId) || null,
              companyName: normalizeString(preDoc.companyName) || null,
              companyLogo,
              workCategory: normalizeString(preDoc.workCategory) || null,
            },
          ],
          accompanyingCount: '0',
          vehicleNumber: preDoc.vehicleNumber || null,
          isPreApproval: true,
          isSilentDelivery:
            preDoc.visitorType === 'delivery_executive' ? Boolean(preDoc.isSilentDelivery) : null,
          isPrivateInvite:
            preDoc.visitorType === 'taxi_vehicle_driver' || preDoc.visitorType === 'other_visitor'
              ? Boolean(preDoc.isPrivateInvite)
              : null,
          cancelledReason: normalizeString(preDoc.cancelledReason) || null,
          cancelledDescription: normalizeString(preDoc.cancelledDescription) || null,
          cancelledAt: preDoc.cancelledAt ? toISTDateTimeLabel(preDoc.cancelledAt) : null,
        },
      });
    }

    
    const guestInvite = await GuestInvite.findOne({
      inviteId: requestId,
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
    }).lean();

    if (guestInvite) {
      const effectiveStatus = resolveActiveStatus(guestInvite.status, guestInvite.validTill, new Date());
      const inviteStatusLabel = (status) =>
        status === 'active' ? 'Pre Approved' : status === 'expired' ? 'Expired' : 'Cancelled';
      const fromLabel = toISTDateTimeLabelNoComma(guestInvite.validFrom);
      const tillLabel = toISTDateTimeLabelNoComma(guestInvite.validTill);
      const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;

      const invitedByUser = guestInvite.invitedByUserId
        ? await User.findById(guestInvite.invitedByUserId, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
        : null;
      const cancelledByUser = guestInvite.cancelledByUserId
        ? await User.findById(guestInvite.cancelledByUserId, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
        : null;

      let guests = (guestInvite.guests || []).map((g) => ({
        guestId: g.guestId,
        name: g.name,
        countryCode: g.countryCode || '+91',
        phoneNumber: g.phoneNumber || null,
        qrCodeImage:
          guestInvite.type === 'group'
            ? guestInvite.qrCodeImage || null
            : g.qrCodeImage || null,
        hasArrived: g.hasArrived || false,
        arrivedAt: g.arrivedAt ? toISTDateTimeLabel(g.arrivedAt) : null,
      }));

      if (guestInvite.type === 'group') {
        const entryDocs = await GuestEntryRequest.find(
          { guestInviteId: guestInvite._id },
          {
            requestId: 1,
            status: 1,
            guestName: 1,
            guestCountryCode: 1,
            guestPhoneNumber: 1,
            guestImageUrl: 1,
            accompanyingCount: 1,
            vehicleNumber: 1,
            entryAllowedAt: 1,
            entryLeftAt: 1,
            isWrongEntry: 1,
          }
        )
          .sort({ createdAt: -1 })
          .lean();

        if (Array.isArray(entryDocs) && entryDocs.length > 0) {
          guests = entryDocs.map((entry) => ({
            guestId: entry.requestId,
            name: entry.guestName || null,
            countryCode: entry.guestCountryCode || '+91',
            phoneNumber: entry.guestPhoneNumber || null,
            imageUrl: entry.guestImageUrl || null,
            status: toMemberStatusLabel(entry.status, entry),
            statusKey: entry.status,
            entryAt: entry.entryAllowedAt ? toISTDateTimeLabel(entry.entryAllowedAt) : null,
            leftAt: entry.entryLeftAt ? toISTDateTimeLabel(entry.entryLeftAt) : null,
            accompanyingCount: String(entry.accompanyingCount || 0),
            vehicleNumber: entry.vehicleNumber || null,
            isWrongEntry: entry.isWrongEntry || false,
            qrCodeImage: guestInvite.qrCodeImage || null,
            hasArrived: Boolean(entry.entryAllowedAt),
            arrivedAt: entry.entryAllowedAt ? toISTDateTimeLabel(entry.entryAllowedAt) : null,
          }));
        }
      }

      return sendSuccessResponse(res, 200, 'Guest invite fetched successfully', {
        data: {
          requestId: guestInvite.inviteId,
          status: inviteStatusLabel(effectiveStatus),
          statusKey: effectiveStatus === 'active' ? 'approved' : effectiveStatus,
          category: 'Guest',
          visitorType: 'Guest',
          inviteType: guestInvite.type,
          isPrivateInvite: guestInvite.isPrivateInvite || false,
          requestedOn: guestInvite.createdAt ? toISTDateTimeLabel(guestInvite.createdAt) : null,
          validityLabel,
          unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
          approver: invitedByUser
            ? {
                name: invitedByUser.fullName || null,
                countryCode: invitedByUser.countryCode || '+91',
                phoneNumber: invitedByUser.phoneNumber || null,
              }
            : null,
          guests,
          maxEntries: guestInvite.type === 'frequent' ? null : guestInvite.maxEntries,
          usedEntries: Array.isArray(guestInvite.entryLogs) ? guestInvite.entryLogs.length : 0,
          cancelledReason: normalizeString(guestInvite.cancelledReason) || null,
          cancelledDescription: normalizeString(guestInvite.cancelledDescription) || null,
          cancelledAt: guestInvite.cancelledAt ? toISTDateTimeLabel(guestInvite.cancelledAt) : null,
          cancelledBy: cancelledByUser
            ? {
                name: cancelledByUser.fullName || null,
                countryCode: cancelledByUser.countryCode || '+91',
                phoneNumber: cancelledByUser.phoneNumber || null,
              }
            : null,
          isGuestInvite: true,
        },
      });
    }

    return next(createHttpError('Request not found', 404));
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guest entry request'));
  }
};


const decideGuestEntryRequest = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can perform this action', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    const requestId = normalizeString(req.body?.requestId || req.params?.requestId);
    const decision = normalizeString(req.body?.decision).toLowerCase();
    if (!unitId) return next(createHttpError('unitId is required', 400));
    if (!requestId) return next(createHttpError('requestId is required', 400));
    if (decision !== 'approve' && decision !== 'reject') {
      return next(createHttpError("decision must be 'approve' or 'reject'", 400));
    }

    const reason = normalizeString(req.body?.reason);
    const description = normalizeString(req.body?.description);
    if (decision === 'reject') {
      if (!reason) return next(createHttpError('reason is required for rejection', 400));
      if (reason.toLowerCase() === 'other' && !description) {
        return next(createHttpError('description is required when reason is other', 400));
      }
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (
      String(doc.societyId) !== String(unitDoc.societyId) ||
      doc.wingNameLower !== unitDoc.wingNameLower ||
      doc.unitNumberLower !== unitDoc.unitNumberLower
    ) {
      return next(createHttpError('Forbidden: request does not belong to this unit', 403));
    }

    
    if (doc.status === 'pending' && doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      doc.status = 'expired';
      await doc.save();
      return next(createHttpError('Request has expired', 409));
    }

    if (doc.status !== 'pending') {
      return next(createHttpError(`Request is already ${doc.status}`, 409));
    }

    if (decision === 'approve') {
      doc.status = 'approved';
      doc.approvedByUserId = authUser._id;
      doc.approvedAt = new Date();
      doc.rejectedReason = null;
      doc.rejectedDescription = null;
    } else {
      doc.status = 'rejected';
      doc.rejectedByUserId = authUser._id;
      doc.rejectedAt = new Date();
      doc.rejectedReason = reason;
      doc.rejectedDescription = description;
    }

    await doc.save();

    // Send notification to guard about member's decision
    if (doc.createdByGuardId) {
      console.log(`[GuestEntryRequest] Sending ${decision} notification to guard:`, doc.createdByGuardId);
      const notification = getNotificationContent(doc, decision === 'approve' ? 'approved' : 'denied');
      sendToUser(
        doc.createdByGuardId,
        notification.title,
        notification.body,
        {
          type: decision === 'approve' ? 'guest_entry_approved' : 'guest_entry_rejected',
          requestId: doc.requestId,
          visitorType: doc.visitorType || 'guest',
          status: decision === 'approve' ? 'approved' : 'rejected',
        }
      ).then((result) => {
        console.log(`[GuestEntryRequest] ${decision} notification result:`, result);
      }).catch((err) => {
        console.error(`[GuestEntryRequest] Failed to send ${decision} notification to guard:`, err.message);
      });
    } else {
      console.log('[GuestEntryRequest] No createdByGuardId found, skipping notification');
    }

    return sendSuccessResponse(res, 200, 'Guest entry request updated successfully', {
      data: {
        requestId: doc.requestId,
        status: doc.status === 'approved' ? 'Approved' : 'Denied',
        decidedAt: doc.status === 'approved' ? doc.approvedAt : doc.rejectedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update guest entry request'));
  }
};


const allowGuestEntry = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const requestId = normalizeString(req.body?.requestId || req.query?.requestId || req.params?.requestId);
    const requestIdsRaw = req.body?.requestIds ?? req.query?.requestIds;

    const requestIds =
      Array.isArray(requestIdsRaw)
        ? requestIdsRaw.map((x) => normalizeString(x)).filter(Boolean)
        : typeof requestIdsRaw === 'string'
          ? requestIdsRaw
              .split(',')
              .map((x) => normalizeString(x))
              .filter(Boolean)
          : [];

    if (!requestId && requestIds.length === 0) return next(createHttpError('requestId is required', 400));

    
    if (!requestId && requestIds.length > 0) {
      const docs = await GuestEntryRequest.find({ requestId: { $in: requestIds } });
      if (!docs || docs.length === 0) return next(createHttpError('Request not found', 404));

      const sameSociety = docs.filter((d) => String(d.societyId) === String(activeDuty.societyId));
      if (sameSociety.length === 0) return next(createHttpError('Request does not belong to this society', 403));

      const nowMs = Date.now();
      let anyApproved = false;

      for (const d of sameSociety) {
        if (d.status === 'pending' && d.expiresAt && d.expiresAt.getTime() <= nowMs) {
          d.status = 'expired';
        }
        if (d.status === 'approved') {
          anyApproved = true;
          d.status = 'entered';
          d.entryAllowedByGuardId = authUser._id;
          d.entryAllowedAt = new Date();
          d.gateId = activeDuty.dutyGateId || d.gateId;
          d.gateName = activeDuty.dutyGateName || d.gateName;
        }
      }

      if (!anyApproved && !sameSociety.some((d) => d.status === 'entered')) {
        return next(createHttpError('Entry can only be allowed for approved requests', 409));
      }

      await Promise.all(sameSociety.map((d) => d.save()));

      // Send notifications to members for batch entry
      for (const d of sameSociety) {
        if (d.status === 'entered' && d.recipientUserIds && d.recipientUserIds.length > 0) {
          const notification = getNotificationContent(d, 'entry');
          sendToUsers(
            d.recipientUserIds,
            notification.title,
            notification.body,
            {
              type: 'guest_entry',
              requestId: d.requestId,
              visitorType: d.visitorType || 'guest',
              status: 'entered',
            }
          ).catch((err) => {
            console.error('[GuestEntryRequest] Failed to send batch entry notification:', err.message);
          });
        }
      }

      
      req.query.requestIds = requestIds.join(',');
      req.query.requestId = undefined;
      return getGuestEntryRequestForGuard(req, res, next);
    }

    
    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (String(doc.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Request does not belong to this society', 403));
    }

    if (doc.status === 'pending' && doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      doc.status = 'expired';
      await doc.save();
    }

    if (doc.status !== 'approved' && doc.status !== 'entered') {
      return next(createHttpError('Entry can only be allowed for approved requests', 409));
    }

    if (doc.status === 'entered') {
      const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
      const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
        ? await User.findById(doc.approvedByGuardId).lean()
        : null;
      const companyLogo = await resolveCompanyLogoForRequest({
        visitorType: doc.visitorType,
        companyName: doc.visitorCompanyName,
      });
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
      return sendSuccessResponse(res, 200, 'Entry already allowed', { data: payload });
    }

    doc.status = 'entered';
    doc.entryAllowedByGuardId = authUser._id;
    doc.entryAllowedAt = new Date();
    doc.gateId = activeDuty.dutyGateId || doc.gateId;
    doc.gateName = activeDuty.dutyGateName || doc.gateName;

    await doc.save();

    // Send notification to members about guest entry
    if (doc.recipientUserIds && doc.recipientUserIds.length > 0) {
      const notification = getNotificationContent(doc, 'entry');
      sendToUsers(
        doc.recipientUserIds,
        notification.title,
        notification.body,
        {
          type: 'guest_entry',
          requestId: doc.requestId,
          visitorType: doc.visitorType || 'guest',
          status: 'entered',
        }
      ).catch((err) => {
        console.error('[GuestEntryRequest] Failed to send entry notification to members:', err.message);
      });
    }

    const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
    const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
      ? await User.findById(doc.approvedByGuardId).lean()
      : null;
    const companyLogo = await resolveCompanyLogoForRequest({
      visitorType: doc.visitorType,
      companyName: doc.visitorCompanyName,
    });
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
    return sendSuccessResponse(res, 200, 'Entry allowed successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to allow entry'));
  }
};

const allowEntryWithoutApproval = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const requestId = normalizeString(req.body?.requestId || req.query?.requestId || req.params?.requestId);
    const requestIdsRaw = req.body?.requestIds ?? req.query?.requestIds;

    const requestIds =
      Array.isArray(requestIdsRaw)
        ? requestIdsRaw.map((x) => normalizeString(x)).filter(Boolean)
        : typeof requestIdsRaw === 'string'
          ? requestIdsRaw
              .split(',')
              .map((x) => normalizeString(x))
              .filter(Boolean)
          : [];

    if (!requestId && requestIds.length === 0) return next(createHttpError('requestId is required', 400));

    if (!requestId && requestIds.length > 0) {
      const docs = await GuestEntryRequest.find({ requestId: { $in: requestIds } });
      if (!docs || docs.length === 0) return next(createHttpError('Request not found', 404));

      const sameSociety = docs.filter((d) => String(d.societyId) === String(activeDuty.societyId));
      if (sameSociety.length === 0) return next(createHttpError('Request does not belong to this society', 403));

      const nowMs = Date.now();
      let anyPending = false;

      for (const d of sameSociety) {
        if (d.status === 'pending' && d.expiresAt && d.expiresAt.getTime() <= nowMs) {
          d.status = 'expired';
          await d.save();
          continue;
        }
        
        if (d.status === 'pending') {
          anyPending = true;
          d.status = 'approved';
          d.approvedByGuardWithoutMemberResponse = true;
          d.approvedByGuardId = authUser._id;
          d.approvedByGuardAt = new Date();
          d.entryAllowedByGuardId = authUser._id;
          d.entryAllowedAt = new Date();
          d.gateId = activeDuty.dutyGateId || d.gateId;
          d.gateName = activeDuty.dutyGateName || d.gateName;
          d.status = 'entered';
        }
      }

      if (!anyPending && !sameSociety.some((d) => d.status === 'entered')) {
        return next(createHttpError('No pending requests found to allow entry without approval', 409));
      }

      await Promise.all(sameSociety.map((d) => d.save()));

      req.query.requestIds = requestIds.join(',');
      req.query.requestId = undefined;
      return getGuestEntryRequestForGuard(req, res, next);
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (String(doc.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Request does not belong to this society', 403));
    }

    if (doc.status === 'pending' && doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      doc.status = 'expired';
      await doc.save();
      return next(createHttpError('Request has expired', 409));
    }

    if (doc.status !== 'pending') {
      if (doc.status === 'approved') {
        return next(createHttpError('Request is already approved. Use allowEntry endpoint instead.', 409));
      }
      if (doc.status === 'entered') {
        const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
          ? await User.findById(doc.approvedByGuardId).lean()
          : null;
        const companyLogo = await resolveCompanyLogoForRequest({
          visitorType: doc.visitorType,
          companyName: doc.visitorCompanyName,
        });
        const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser: null, approvedByGuard, companyLogo });
        return sendSuccessResponse(res, 200, 'Entry already allowed', { data: payload });
      }
      return next(createHttpError(`Cannot allow entry for request with status: ${doc.status}`, 409));
    }

    doc.status = 'approved';
    doc.approvedByGuardWithoutMemberResponse = true;
    doc.approvedByGuardId = authUser._id;
    doc.approvedByGuardAt = new Date();
    doc.entryAllowedByGuardId = authUser._id;
    doc.entryAllowedAt = new Date();
    doc.gateId = activeDuty.dutyGateId || doc.gateId;
    doc.gateName = activeDuty.dutyGateName || doc.gateName;
    doc.status = 'entered';

    await doc.save();

    const companyLogo = await resolveCompanyLogoForRequest({
      visitorType: doc.visitorType,
      companyName: doc.visitorCompanyName,
    });
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser: null, approvedByGuard: authUser, companyLogo });
    return sendSuccessResponse(res, 200, 'Entry allowed without member approval', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to allow entry without approval'));
  }
};

const allowGuestExit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const requestId = normalizeString(req.body?.requestId || req.query?.requestId || req.params?.requestId);
    const requestIdsRaw = req.body?.requestIds ?? req.query?.requestIds;

    const requestIds =
      Array.isArray(requestIdsRaw)
        ? requestIdsRaw.map((x) => normalizeString(x)).filter(Boolean)
        : typeof requestIdsRaw === 'string'
          ? requestIdsRaw
              .split(',')
              .map((x) => normalizeString(x))
              .filter(Boolean)
          : [];

    if (!requestId && requestIds.length === 0) return next(createHttpError('requestId is required', 400));

    
    if (!requestId && requestIds.length > 0) {
      const docs = await GuestEntryRequest.find({ requestId: { $in: requestIds } });
      if (!docs || docs.length === 0) return next(createHttpError('Request not found', 404));

      const sameSociety = docs.filter((d) => String(d.societyId) === String(activeDuty.societyId));
      if (sameSociety.length === 0) return next(createHttpError('Request does not belong to this society', 403));

      let anyEntered = false;
      for (const d of sameSociety) {
        if (d.status === 'entered') {
          anyEntered = true;
          d.status = 'left';
          d.entryLeftByGuardId = authUser._id;
          d.entryLeftAt = new Date();
        }
      }

      if (!anyEntered && !sameSociety.some((d) => d.status === 'left')) {
        return next(createHttpError('Exit can only be allowed for inside society requests', 409));
      }

      await Promise.all(sameSociety.map((d) => d.save()));

      // Send notifications to members for batch exit
      for (const d of sameSociety) {
        if (d.status === 'left' && d.recipientUserIds && d.recipientUserIds.length > 0) {
          const notification = getNotificationContent(d, 'exit');
          sendToUsers(
            d.recipientUserIds,
            notification.title,
            notification.body,
            {
              type: 'guest_exit',
              requestId: d.requestId,
              visitorType: d.visitorType || 'guest',
              status: 'left',
            }
          ).catch((err) => {
            console.error('[GuestEntryRequest] Failed to send batch exit notification:', err.message);
          });
        }
      }

      req.query.requestIds = requestIds.join(',');
      req.query.requestId = undefined;
      return getGuestEntryRequestForGuard(req, res, next);
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (String(doc.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Request does not belong to this society', 403));
    }

    if (doc.status !== 'entered' && doc.status !== 'left') {
      return next(createHttpError('Exit can only be allowed for inside society requests', 409));
    }

    if (doc.status === 'left') {
      const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
      const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
        ? await User.findById(doc.approvedByGuardId).lean()
        : null;
      const companyLogo = await resolveCompanyLogoForRequest({
        visitorType: doc.visitorType,
        companyName: doc.visitorCompanyName,
      });
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
      return sendSuccessResponse(res, 200, 'Exit already allowed', { data: payload });
    }

    doc.status = 'left';
    doc.entryLeftByGuardId = authUser._id;
    doc.entryLeftAt = new Date();

    await doc.save();

    // Send notification to members about guest exit
    if (doc.recipientUserIds && doc.recipientUserIds.length > 0) {
      const notification = getNotificationContent(doc, 'exit');
      sendToUsers(
        doc.recipientUserIds,
        notification.title,
        notification.body,
        {
          type: 'guest_exit',
          requestId: doc.requestId,
          visitorType: doc.visitorType || 'guest',
          status: 'left',
        }
      ).catch((err) => {
        console.error('[GuestEntryRequest] Failed to send exit notification to members:', err.message);
      });
    }

    const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
    const approvedByGuard = doc.approvedByGuardWithoutMemberResponse && doc.approvedByGuardId
      ? await User.findById(doc.approvedByGuardId).lean()
      : null;
    const companyLogo = await resolveCompanyLogoForRequest({
      visitorType: doc.visitorType,
      companyName: doc.visitorCompanyName,
    });
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser, approvedByGuard, companyLogo });
    return sendSuccessResponse(res, 200, 'Exit allowed successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to allow exit'));
  }
};

const updateGuestEntryRequestPhoto = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const requestId = normalizeString(req.body?.requestId || req.params?.requestId || req.query?.requestId);
    const imageUrl = normalizeString(req.body?.imageUrl);

    if (!imageUrl) return next(createHttpError('imageUrl is required', 400));

    if (!requestId) {
      return createGuestEntryRequest(req, res, next);
    }

    const draft = await GuestEntryRequestDraft.findOne({ requestId }).lean();
    if (draft) {
      const draftUnits = Array.isArray(draft.unitNumbers) ? draft.unitNumbers.filter(Boolean) : [];
      req.body = {
        visitorType: draft.visitorType,
        companyName: draft.visitorCompanyName || null,
        deliveryCompanyName: draft.visitorCompanyName || null,
        workCategory: draft.visitorWorkCategory || null,
        guestName: draft.guestName,
        phoneNumber: draft.guestPhoneNumber,
        countryCode: draft.guestCountryCode || '+91',
        vehicleNumber: draft.vehicleNumber || null,
        accompanyingCount: draft.accompanyingCount || 0,
        wingName: draft.wingName,
        ...(draftUnits.length <= 1
          ? { unitNumber: draftUnits[0] || null }
          : { unitNumber: draftUnits }),
        imageUrl,
      };

      await createGuestEntryRequest(req, res, next);
      await GuestEntryRequestDraft.deleteOne({ _id: draft._id });
      return;
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (String(doc.societyId) !== String(activeDuty.societyId)) {
      return next(createHttpError('Request does not belong to this society', 403));
    }

    doc.guestImageUrl = imageUrl;
    await doc.save();

    const labels = toVisitorLabels(doc.visitorType || 'guest');

    return sendSuccessResponse(res, 200, 'Guest photo updated successfully', {
      data: {
        requestId: doc.requestId,
        status: 'Awaiting Approval',
        category: labels.category,
        visitorType: labels.visitorType,
        photoRequired: false,
        requestsendat: doc.createdAt ? toISTDateTimeLabel(doc.createdAt) : null,
        expiresAt: doc.expiresAt ? toISTDateTimeLabel(doc.expiresAt) : null,
        unit: { wingName: doc.wingName, unitNumber: doc.unitNumber },
        guest: {
          name: doc.guestName,
          countryCode: doc.guestCountryCode || '+91',
          phoneNumber: doc.guestPhoneNumber,
          imageUrl: doc.guestImageUrl || null,
          companyName: doc.visitorCompanyName || null,
          workCategory: doc.visitorWorkCategory || null,
        },
        accompanyingCount: String(doc.accompanyingCount || 0),
        vehicleNumber: doc.vehicleNumber || null,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update guest photo'));
  }
};

const allowGuestExitForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can perform this action', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    const requestId = normalizeString(req.body?.requestId);

    if (!unitId) return next(createHttpError('unitId is required', 400));
    if (!requestId) return next(createHttpError('requestId is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (
      String(doc.societyId) !== String(unitDoc.societyId) ||
      doc.wingNameLower !== unitDoc.wingNameLower ||
      doc.unitNumberLower !== unitDoc.unitNumberLower
    ) {
      return next(createHttpError('Request does not belong to this unit', 403));
    }

    if (doc.status !== 'entered' && doc.status !== 'left') {
      return next(createHttpError('Exit can only be marked for visitors inside society', 409));
    }

    
    const findGuardOnDuty = async (societyId) => {
      const guard = await User.findOne({
        role: 'guard',
        'guardSocieties.societyId': societyId,
        'guardSocieties.isOnDuty': true,
      }, { fullName: 1 }).lean();
      return guard;
    };

    const buildExitResponse = async (document, isAlreadyLeft = false) => {
      const labels = toVisitorLabels(document.visitorType || 'guest');
      
      const approvedByUser = document.approvedByUserId
        ? await User.findById(document.approvedByUserId, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
        : null;

      let exitNotifier = null;
      if (document.entryLeftByGuardId) {
        const guard = await User.findById(document.entryLeftByGuardId, { fullName: 1 }).lean();
        exitNotifier = guard ? { name: `${guard.fullName || 'Guard'} (Security)`, role: 'guard' } : null;
      } else if (document.entryLeftByMemberId) {
        
        const guardOnDuty = await findGuardOnDuty(document.societyId);
        if (guardOnDuty) {
          exitNotifier = { name: `${guardOnDuty.fullName || 'Guard'} (Security)`, role: 'guard' };
        } else {
          
          const member = await User.findById(document.entryLeftByMemberId, { fullName: 1 }).lean();
          exitNotifier = member ? { name: member.fullName || 'Member', role: 'member' } : null;
        }
      }

      return {
        requestId: document.requestId,
        status: 'Left Society',
        statusKey: 'left',
        category: labels.category,
        visitorType: labels.visitorType,
        unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
        guest: {
          name: document.guestName,
          countryCode: document.guestCountryCode || '+91',
          phoneNumber: document.guestPhoneNumber,
          imageUrl: document.guestImageUrl || null,
          companyName: document.visitorCompanyName || null,
          workCategory: document.visitorWorkCategory || null,
        },
        entryAt: document.entryAllowedAt ? toISTDateTimeLabel(document.entryAllowedAt) : null,
        approver: approvedByUser
          ? {
              name: approvedByUser.fullName || null,
              countryCode: approvedByUser.countryCode || '+91',
              phoneNumber: approvedByUser.phoneNumber || null,
            }
          : null,
        exitAt: document.entryLeftAt ? toISTDateTimeLabel(document.entryLeftAt) : null,
        exitNotifier,
        accompanyingCount: String(document.accompanyingCount || 0),
        vehicleNumber: document.vehicleNumber || null,
      };
    };

    if (doc.status === 'left') {
      const payload = await buildExitResponse(doc, true);
      return sendSuccessResponse(res, 200, 'Visitor has already left', { data: payload });
    }

    doc.status = 'left';
    doc.entryLeftByMemberId = authUser._id;
    doc.entryLeftAt = new Date();
    await doc.save();

    const payload = await buildExitResponse(doc);
    return sendSuccessResponse(res, 200, 'Visitor marked as left successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to mark visitor as left'));
  }
};

const WRONG_ENTRY_REASONS = [
  'unknown_visitor',
  'did_not_invite',
  'fraudulent',
  'wrong_flat',
  'other',
];

const markWrongEntryForMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can perform this action', 403));
    }

    const unitId = normalizeString(req.body?.unitId);
    const requestId = normalizeString(req.body?.requestId);
    const reason = normalizeOption(req.body?.reason);
    const description = normalizeString(req.body?.description);

    if (!unitId) return next(createHttpError('unitId is required', 400));
    if (!requestId) return next(createHttpError('requestId is required', 400));
    if (!reason) return next(createHttpError('reason is required', 400));

    if (!WRONG_ENTRY_REASONS.includes(reason)) {
      return next(createHttpError(`Invalid reason. Allowed: ${WRONG_ENTRY_REASONS.join(', ')}`, 400));
    }

    if (reason === 'other' && !description) {
      return next(createHttpError('Description is required when reason is "other"', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const doc = await GuestEntryRequest.findOne({ requestId });
    if (!doc) return next(createHttpError('Request not found', 404));

    if (
      String(doc.societyId) !== String(unitDoc.societyId) ||
      doc.wingNameLower !== unitDoc.wingNameLower ||
      doc.unitNumberLower !== unitDoc.unitNumberLower
    ) {
      return next(createHttpError('Request does not belong to this unit', 403));
    }

    if (doc.status !== 'entered' && doc.status !== 'left') {
      return next(createHttpError('Wrong entry can only be marked for visitors who have entered the society', 409));
    }

    if (doc.isWrongEntry) {
      return sendSuccessResponse(res, 200, 'This visitor is already marked as wrong entry', {
        data: { requestId: doc.requestId, isWrongEntry: true, status: 'wrong_entry' },
      });
    }

    
    doc.isWrongEntry = true;
    doc.wrongEntryReason = reason;
    doc.wrongEntryDescription = reason === 'other' ? description : null;
    doc.wrongEntryMarkedByMemberId = authUser._id;
    doc.wrongEntryMarkedAt = new Date();
    doc.status = 'wrong_entry';
    await doc.save();

    const labels = toVisitorLabels(doc.visitorType || 'guest');

    
    const approvedByUser = doc.approvedByUserId
      ? await User.findById(doc.approvedByUserId, { fullName: 1 }).lean()
      : null;

    
    let exitNotifier = null;
    if (doc.entryLeftByGuardId) {
      const guard = await User.findById(doc.entryLeftByGuardId, { fullName: 1 }).lean();
      exitNotifier = guard ? { name: `${guard.fullName || 'Guard'} (Security)`, role: 'guard' } : null;
    } else if (doc.entryLeftByMemberId) {
      const guardOnDuty = await User.findOne({
        role: 'guard',
        'guardSocieties.societyId': doc.societyId,
        'guardSocieties.isOnDuty': true,
      }, { fullName: 1 }).lean();
      if (guardOnDuty) {
        exitNotifier = { name: `${guardOnDuty.fullName || 'Guard'} (Security)`, role: 'guard' };
      } else {
        const member = await User.findById(doc.entryLeftByMemberId, { fullName: 1 }).lean();
        exitNotifier = member ? { name: member.fullName || 'Member', role: 'member' } : null;
      }
    }

    const exitAt = doc.entryLeftAt ? toISTDateTimeLabel(doc.entryLeftAt) : null;
    const payload = {
      requestId: doc.requestId,
      status: 'Wrong Entry',
      statusKey: 'wrong_entry',
      isWrongEntry: true,
      category: labels.category,
      visitorType: labels.visitorType,
      unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
      guest: {
        name: doc.guestName,
        countryCode: doc.guestCountryCode || '+91',
        phoneNumber: doc.guestPhoneNumber,
        imageUrl: doc.guestImageUrl || null,
      },
      entryAt: doc.entryAllowedAt ? toISTDateTimeLabel(doc.entryAllowedAt) : null,
      approver: approvedByUser ? { name: approvedByUser.fullName || null } : null,
      ...(exitAt ? { exitAt } : {}),
      ...(exitNotifier ? { exitNotifier } : {}),
      wrongEntryMarkedAt: toISTDateTimeLabel(doc.wrongEntryMarkedAt),
      wrongEntryNotifier: { name: authUser.fullName || 'Member' },
      wrongEntryReason: reason,
      wrongEntryDescription: doc.wrongEntryDescription || null,
    };

    return sendSuccessResponse(res, 200, 'Visitor marked as wrong entry successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to mark visitor as wrong entry'));
  }
};

const createOnboardedVisitorEntry = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const userId = normalizeString(req.body?.userId);
    const wingName = normalizeString(req.body?.wingName ?? req.body?.wing);
    const unitNumberRaw = req.body?.unitNumber ?? req.body?.unit;
    const unitNumbers = Array.isArray(unitNumberRaw)
      ? unitNumberRaw.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    const unitNumber = Array.isArray(unitNumberRaw) ? null : normalizeString(unitNumberRaw);
    const imageUrl = normalizeString(req.body?.imageUrl) || null;
    const vehicleNumber = normalizeString(req.body?.vehicleNumber).toUpperCase() || null;
    const accompanyingCountRaw = req.body?.accompanyingCount ?? req.body?.accompanyingPerson;
    const accompanyingCountNumber = Number(accompanyingCountRaw);
    const accompanyingCount = Number.isFinite(accompanyingCountNumber) && accompanyingCountNumber > 0 ? accompanyingCountNumber : 0;

    if (!userId) return next(createHttpError('userId is required', 400));
    if (!wingName) return next(createHttpError('wingName is required', 400));
    if (unitNumbers.length === 0 && !unitNumber) {
      return next(createHttpError('unitNumber is required', 400));
    }

    
    const visitor = await User.findById(userId).lean();
    if (!visitor) return next(createHttpError('Visitor not found', 404));
    if (visitor.role !== 'visitor') return next(createHttpError('User is not an onboarded visitor', 400));

    
    const visitorType = visitor.visitorType || 'guest';
    if (!VISITOR_TYPES.includes(visitorType)) {
      return next(createHttpError('Invalid visitor type', 400));
    }
    if (unitNumbers.length > 0 && visitorType !== 'delivery_executive') {
      return next(
        createHttpError('Multiple units are only supported for delivery executive', 400)
      );
    }

    const guestName = visitor.fullName || 'Unknown Visitor';
    const phoneDigits = normalizePhoneDigits(visitor.phoneNumber);
    const countryCode = normalizeCountryCode(visitor.countryCode || '+91');
    const companyName = visitor.visitorCompanyName || null;
    const workCategory = visitor.visitorWorkCategory || null;

    if (!phoneDigits) {
      return next(createHttpError('Visitor does not have a valid phone number', 400));
    }

    
    const alreadyInsideEntry = await checkVisitorAlreadyInside({
      societyId: activeDuty.societyId,
      phoneDigits,
    });
    if (alreadyInsideEntry) {
      return next(
        createHttpError(
          `This visitor is already inside the society (Entry: ${alreadyInsideEntry.requestId}). Please mark exit first.`,
          409
        )
      );
    }

    
    const finalImageUrl = imageUrl || visitor.profilePhoto || null;

    
    const unitsToProcess = unitNumbers.length > 0 ? unitNumbers : [unitNumber];
    const recipientsByUnit = new Map();
    const missingUnits = [];

    for (const targetUnit of unitsToProcess) {
      const recipientUserIds = await resolveUnitResidents({
        societyId: activeDuty.societyId,
        wingNameLower: wingName.toLowerCase(),
        unitNumberLower: targetUnit.toLowerCase(),
      });

      if (!recipientUserIds || recipientUserIds.length === 0) {
        missingUnits.push(targetUnit);
      } else {
        recipientsByUnit.set(targetUnit, recipientUserIds);
      }
    }

    if (missingUnits.length > 0) {
      return next(
        createHttpError(
          `No residents found for units: ${missingUnits.join(', ')}. Cannot send approval request.`,
          404
        )
      );
    }

    const unitNumberLowers = unitsToProcess.map((u) => u.toLowerCase());
    const unitDocs = await MemberUnit.find(
      {
        societyId: activeDuty.societyId,
        wingNameLower: wingName.toLowerCase(),
        unitNumberLower: { $in: unitNumberLowers },
        $or: [
          { occupancyStatus: 'currently_residing' },
          { occupancyStatus: 'unit_rented', occupantType: { $in: ['tenant', 'tenant_family_member'] } },
        ],
      },
      { _id: 1, unitNumberLower: 1 }
    ).lean();
    const unitByNumber = new Map();
    for (const unit of unitDocs || []) {
      const key = unit.unitNumberLower;
      if (key && !unitByNumber.has(key)) {
        unitByNumber.set(key, unit);
      }
    }

    const now = new Date();
    const createdDocs = await Promise.all(
      unitsToProcess.map(async (targetUnit) => {
        const unitKey = targetUnit.toLowerCase();
        const unitDoc = unitByNumber.get(unitKey);
        const preApproval = unitDoc
          ? await resolvePreApprovalForUnit({
              visitorType,
              societyId: activeDuty.societyId,
              unitId: unitDoc._id,
              companyName,
              workCategory,
              vehicleNumber,
              guestName,
              phoneDigits,
              now,
            })
          : null;

        const autoApproved = Boolean(preApproval);
        const expiresAt = autoApproved ? null : new Date(Date.now() + 30 * 60 * 1000);

        return GuestEntryRequest.create({
          societyId: activeDuty.societyId,
          wingName,
          wingNameLower: wingName.toLowerCase(),
          unitNumber: targetUnit,
          unitNumberLower: unitKey,
          createdByGuardId: authUser._id,
          gateId: activeDuty.dutyGateId || null,
          gateName: activeDuty.dutyGateName || null,
          guestName,
          guestCountryCode: countryCode,
          guestPhoneNumber: phoneDigits,
          guestPhoneDigits: phoneDigits,
          guestImageUrl: finalImageUrl,
          visitorType,
          visitorUserId: visitor._id,
          visitorCompanyName: companyName,
          visitorWorkCategory: workCategory,
          accompanyingCount,
          vehicleNumber,
          status: autoApproved ? 'approved' : 'pending',
          approvedByUserId: autoApproved && preApproval?.invitedByUserId ? preApproval.invitedByUserId : null,
          approvedAt: autoApproved ? now : null,
          expiresAt,
          recipientUserIds: recipientsByUnit.get(targetUnit),
        });
      })
    );

    const labels = toVisitorLabels(visitorType);
    const companyLogo = await resolveCompanyLogoForRequest({ visitorType, companyName });

    
    for (const doc of createdDocs) {
      if (doc.status === 'pending' && doc.recipientUserIds && doc.recipientUserIds.length > 0) {
        const notification = getNotificationContent(doc, 'approval');
        sendToUsers(
          doc.recipientUserIds,
          notification.title,
          notification.body,
          {
            type: 'guest_entry_request',
            requestId: doc.requestId,
            visitorType: visitorType || 'guest',
            status: 'pending',
          }
        ).catch((err) => {
          console.error('[OnboardedVisitorEntry] Failed to send push notification:', err.message);
        });
      }
    }

    const primaryDoc = createdDocs[0];
    const basePayload = {
      status: getStatusLabel(primaryDoc.status),
      statusKey: primaryDoc.status,
      category: labels.category,
      visitorType: labels.visitorType,
      requestedOn: primaryDoc.createdAt ? toISTDateTimeLabel(primaryDoc.createdAt) : null,
      expiresAt: primaryDoc.expiresAt ? toISTDateTimeLabel(primaryDoc.expiresAt) : null,
      guest: {
        id: String(visitor._id),
        name: guestName,
        countryCode,
        phoneNumber: phoneDigits,
        imageUrl: finalImageUrl,
        companyName,
        companyLogo,
        workCategory,
      },
      accompanyingCount: String(accompanyingCount),
      vehicleNumber,
    };

    if (createdDocs.length === 1) {
      return sendSuccessResponse(res, 201, 'Visitor entry request created successfully', {
        data: {
          ...basePayload,
          requestId: primaryDoc.requestId,
          unit: { wingName: primaryDoc.wingName, unitNumber: primaryDoc.unitNumber },
        },
      });
    }

    return sendSuccessResponse(res, 201, 'Visitor entry requests created successfully', {
      data: {
        ...basePayload,
        requestIds: createdDocs.map((d) => d.requestId),
        units: createdDocs.map((d) => ({ wingName: d.wingName, unitNumber: d.unitNumber })),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create visitor entry request'));
  }
};

module.exports = {
  getRecentGuestsForGuard,
  listGuestEntryRequestsForGuard,
  createGuestEntryRequest,
  createOnboardedVisitorEntry,
  getGuestEntryRequestForGuard,
  listGuestEntryRequestsForMember,
  listGuestEntryRequestsForSocietyAdmin,
  getGuestEntryRequestDetailForMember,
  decideGuestEntryRequest,
  allowGuestEntry,
  allowEntryWithoutApproval,
  allowGuestExit,
  allowGuestExitForMember,
  markWrongEntryForMember,
  updateGuestEntryRequestPhoto,
  resolveExistingVisitorPhoto,
};


