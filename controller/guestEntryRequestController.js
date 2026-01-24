const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const GuestEntryRequestDraft = require('../model/guestEntryRequestDraftSchema');
const GuestInvite = require('../model/guestInviteSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const TaxiDriverCompany = require('../model/taxiDriverCompanySchema');
const DeliveryPreApproval = require('../model/deliveryPreApprovalSchema');
const TaxiDriverPreApproval = require('../model/taxiDriverPreApprovalSchema');
const OtherVisitorPreApproval = require('../model/otherVisitorPreApprovalSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { normalizeString } = require('../utils/strings');
const { getTaxiCompanyInfo } = require('../utils/taxiDriverCompanies');
const { getWorkCategoryDisplayName } = require('../utils/workCategories');
const { normalizeCountryCode, normalizeDigits, isTenDigitPhone } = require('../utils/phoneNumber');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { toISTDateTimeLabel } = require('../utils/dateTime');

const VISITOR_TYPE_LABELS = {
  guest: { category: 'Guest', visitorType: 'Guest' },
  delivery_executive: { category: 'Delivery', visitorType: 'Delivery Executive' },
  taxi_vehicle_driver: { category: 'Taxi', visitorType: 'Taxi' },
  other_visitor: { category: 'Visitor', visitorType: 'Other Visitor' },
};

const VISITOR_TYPES = ['guest', 'delivery_executive', 'taxi_vehicle_driver', 'other_visitor'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'entered', 'left'];
const STATUS_FILTERS = {
  awaiting_approval: ['pending'],
  pending: ['pending'],
  approved: ['approved'],
  inside_society: ['entered'],
  entered: ['entered'],
  left_society: ['rejected', 'cancelled', 'expired', 'left'],
  rejected: ['rejected'],
  denied: ['rejected'],
  cancelled: ['cancelled'],
  expired: ['expired'],
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

const toGuardCardPayload = ({ reqDoc, approvedByUser }) => {
  const statusLabel = getStatusLabel(reqDoc.status);


  const labels = toVisitorLabels(reqDoc.visitorType || 'guest');

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
    workCategory: reqDoc.visitorWorkCategory || null,
    approvedBy: approvedByUser
      ? {
        id: String(approvedByUser._id),
        name: approvedByUser.fullName || null,
        countryCode: approvedByUser.countryCode || '+91',
        phoneNumber: approvedByUser.phoneNumber || null,
      }
      : null,

    approvedOn: reqDoc.approvedAt ? toISTDateTimeLabel(reqDoc.approvedAt) : null,
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

    const now = new Date();
    await GuestEntryRequest.updateMany(
      {
        societyId: activeDuty.societyId,
        status: 'pending',
        expiresAt: { $ne: null, $lte: now },
      },
      { $set: { status: 'expired' } }
    );

    const docs = await GuestEntryRequest.find(
      {
        societyId: activeDuty.societyId,
        status: { $in: statusFilter },
        visitorType: { $in: normalizedVisitorTypes },
      },
      {
        requestId: 1,
        visitorType: 1,
        guestName: 1,
        guestCountryCode: 1,
        guestPhoneNumber: 1,
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
        createdAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const approverIds = Array.from(
      new Set(
        docs
          .map((d) => d.approvedByUserId)
          .filter(Boolean)
          .map((id) => String(id))
      )
    );

    const approvers = approverIds.length
      ? await User.find({ _id: { $in: approverIds } }, { fullName: 1, countryCode: 1, phoneNumber: 1 }).lean()
      : [];
    const approverById = new Map(approvers.map((u) => [String(u._id), u]));

    const mapped = docs.map((doc) => {
      const approvedByUser = doc.approvedByUserId ? approverById.get(String(doc.approvedByUserId)) : null;
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });
      return {
        ...payload,
        statusKey: doc.status,
        visitorTypeKey: doc.visitorType || 'guest',
      };
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
    const phoneDigits = normalizeDigits(phoneRaw);
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

    // Multi-request fetch: used for Delivery Executive "partial approved" UI.
    if (!requestId && requestIds.length > 0) {
      const docs = await GuestEntryRequest.find({ requestId: { $in: requestIds } });
      if (!docs || docs.length === 0) return next(createHttpError('Request not found', 404));

      const filtered = docs.filter((d) => String(d.societyId) === String(activeDuty.societyId));
      if (filtered.length === 0) return next(createHttpError('Request does not belong to this society', 403));

      // auto-expire pending requests
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
            return toGuardCardPayload({ reqDoc: d, approvedByUser });
          })
        ),
      };

      return sendSuccessResponse(res, 200, 'Entry requests fetched successfully', { data: payload });
    }

    // Single request fetch (existing behavior)
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
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });

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

    const statusRaw = normalizeString(req.body?.status || 'pending').toLowerCase();
    const status = ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'entered'].includes(statusRaw)
      ? statusRaw
      : 'pending';

    const items = await GuestEntryRequest.find(
      {
        societyId: unitDoc.societyId,
        wingNameLower: unitDoc.wingNameLower,
        unitNumberLower: unitDoc.unitNumberLower,
        status,
      },
      {
        requestId: 1,
        visitorType: 1,
        guestName: 1,
        guestCountryCode: 1,
        guestPhoneNumber: 1,
        guestImageUrl: 1,
        accompanyingCount: 1,
        vehicleNumber: 1,
        status: 1,
        createdAt: 1,
        expiresAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const toStatusLabel = (key) =>
      key === 'approved'
        ? 'Approved'
        : key === 'rejected'
          ? 'Denied'
          : key === 'entered'
            ? 'Inside Society'
            : key === 'left'
              ? 'Left Society'
            : key === 'expired'
              ? 'Expired'
              : key === 'cancelled'
                ? 'Cancelled'
                : 'Awaiting Approval';

    const mapped = (items || []).map((d) => {
      const statusLabel = toStatusLabel(d.status);
      const labels = toVisitorLabels(d.visitorType || 'guest');
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
        },
        accompanyingCount: String(d.accompanyingCount || 0),
        vehicleNumber: d.vehicleNumber || null,

      };
    });

    return sendSuccessResponse(res, 200, 'Guest entry requests fetched successfully', { data: mapped });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guest entry requests'));
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

    // auto-expire
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
    } else {
      doc.status = 'rejected';
      doc.rejectedByUserId = authUser._id;
      doc.rejectedAt = new Date();
    }

    await doc.save();

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

    // Multi-request allow: mark all approved requests as entered.
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

      // Return aggregated payload (same shape as multi-fetch)
      req.query.requestIds = requestIds.join(',');
      req.query.requestId = undefined;
      return getGuestEntryRequestForGuard(req, res, next);
    }

    // Single request allow (existing behavior)
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
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });
      return sendSuccessResponse(res, 200, 'Entry already allowed', { data: payload });
    }

    doc.status = 'entered';
    doc.entryAllowedByGuardId = authUser._id;
    doc.entryAllowedAt = new Date();
    doc.gateId = activeDuty.dutyGateId || doc.gateId;
    doc.gateName = activeDuty.dutyGateName || doc.gateName;

    await doc.save();

    const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });
    return sendSuccessResponse(res, 200, 'Entry allowed successfully', { data: payload });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to allow entry'));
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

    // Multi-request exit: mark all entered requests as left.
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
      const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });
      return sendSuccessResponse(res, 200, 'Exit already allowed', { data: payload });
    }

    doc.status = 'left';
    doc.entryLeftByGuardId = authUser._id;
    doc.entryLeftAt = new Date();

    await doc.save();

    const approvedByUser = doc.approvedByUserId ? await User.findById(doc.approvedByUserId).lean() : null;
    const payload = toGuardCardPayload({ reqDoc: doc, approvedByUser });
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

module.exports = {
  getRecentGuestsForGuard,
  listGuestEntryRequestsForGuard,
  createGuestEntryRequest,
  getGuestEntryRequestForGuard,
  listGuestEntryRequestsForMember,
  decideGuestEntryRequest,
  allowGuestEntry,
  allowGuestExit,
  updateGuestEntryRequestPhoto,
};


