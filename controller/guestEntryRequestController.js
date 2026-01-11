const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const GuestInvite = require('../model/guestInviteSchema');
const MemberUnit = require('../model/memberUnitSchema');
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { normalizeString } = require('../utils/strings');
const { normalizeCountryCode, normalizeDigits, isTenDigitPhone } = require('../utils/phoneNumber');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { toISTDateTimeLabel } = require('../utils/dateTime');

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
  const statusLabel =
    reqDoc.status === 'approved'
      ? 'Approved'
      : reqDoc.status === 'rejected'
        ? 'Rejected'
        : reqDoc.status === 'entered'
          ? 'Entered'
          : reqDoc.status === 'expired'
            ? 'Expired'
            : reqDoc.status === 'cancelled'
              ? 'Cancelled'
              : 'Awaiting Approval';


  return {

    requestId: reqDoc.requestId,
    category: 'Guest',
    status: statusLabel,
    name: reqDoc.guestName,
    visitorType: 'Guest',
    phone: {
      countryCode: reqDoc.guestCountryCode || '+91',
      phoneNumber: reqDoc.guestPhoneNumber,

    },
    accompanyingPerson: reqDoc.accompanyingCount || 0,
    vehicleNumber: reqDoc.vehicleNumber || null,
    unit: {
      wingName: reqDoc.wingName,
      unitNumber: reqDoc.unitNumber,

    },
    imageUrl: reqDoc.guestImageUrl || null,
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
    const unitNumber = normalizeString(req.body?.unitNumber ?? req.body?.unit);
    const daysNumber = Number(req.body?.days);

    if (!wingName) return next(createHttpError('wingName is required', 400));
    if (!unitNumber) return next(createHttpError('unitNumber is required', 400));

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


const createGuestEntryRequest = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    if (authUser.role !== 'guard') return next(createHttpError('Only guards can perform this action', 403));

    const activeDuty = requireGuardOnDuty(authUser);

    const wingName = normalizeString(req.body?.wingName ?? req.body?.wing);
    const unitNumber = normalizeString(req.body?.unitNumber ?? req.body?.unit);
    const guestName = normalizeString(req.body?.guestName ?? req.body?.fullName ?? req.body?.name);
    const phoneRaw = normalizeString(req.body?.phoneNumber ?? req.body?.mobileNumber ?? req.body?.mobile);
    const countryCode = normalizeCountryCode(req.body?.countryCode || '+91');
    const imageUrl = normalizeString(req.body?.imageUrl) || null;

    const accompanyingCountRaw = req.body?.accompanyingCount ?? req.body?.accompanyingPerson ?? req.body?.accompanyingPersons;
    const accompanyingCountNumber = Number(accompanyingCountRaw);
    const accompanyingCount = Number.isFinite(accompanyingCountNumber) && accompanyingCountNumber > 0 ? accompanyingCountNumber : 0;

    const vehicleNumber = normalizeString(req.body?.vehicleNumber).toUpperCase() || null;

    if (!wingName) return next(createHttpError('wingName is required', 400));
    if (!unitNumber) return next(createHttpError('unitNumber is required', 400));
    if (!guestName) return next(createHttpError('guestName is required', 400));
    if (!phoneRaw) return next(createHttpError('phoneNumber is required', 400));
    if (!isTenDigitPhone(phoneRaw)) return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));

    const phoneDigits = normalizeDigits(phoneRaw);

    const recipientUserIds = await resolveUnitResidents({
      societyId: activeDuty.societyId,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
    });

    if (!recipientUserIds || recipientUserIds.length === 0) {
      return next(createHttpError('No residents found for this unit. Cannot send approval request.', 404));
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const doc = await GuestEntryRequest.create({
      societyId: activeDuty.societyId,
      wingName,
      wingNameLower: wingName.toLowerCase(),
      unitNumber,
      unitNumberLower: unitNumber.toLowerCase(),
      createdByGuardId: authUser._id,
      gateId: activeDuty.dutyGateId || null,
      gateName: activeDuty.dutyGateName || null,
      guestName,
      guestCountryCode: countryCode || '+91',
      guestPhoneNumber: phoneDigits,
      guestPhoneDigits: phoneDigits,
      guestImageUrl: imageUrl,
      accompanyingCount,
      vehicleNumber,
      status: 'pending',
      expiresAt,
      recipientUserIds,
    });

    return sendSuccessResponse(res, 201, 'Guest approval request created successfully', {
      data: {
        requestId: doc.requestId,
        status: 'Awaiting Approval',
        expiresAt: doc.expiresAt,
        unit: { wingName: doc.wingName, unitNumber: doc.unitNumber },
        guest: {
          name: doc.guestName,
          countryCode: doc.guestCountryCode || '+91',
          phoneNumber: doc.guestPhoneNumber,
          imageUrl: doc.guestImageUrl || null,
        },
        accompanyingCount: doc.accompanyingCount || 0,
        vehicleNumber: doc.vehicleNumber || null,
        recipientCount: Array.isArray(recipientUserIds) ? recipientUserIds.length : 0,
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
    if (!requestId) return next(createHttpError('requestId is required', 400));

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
          ? 'Rejected'
          : key === 'entered'
            ? 'Entered'
            : key === 'expired'
              ? 'Expired'
              : key === 'cancelled'
                ? 'Cancelled'
                : 'Awaiting Approval';

    const mapped = (items || []).map((d) => {
      const statusLabel = toStatusLabel(d.status);
      return {
        requestId: d.requestId,
        status: statusLabel,
        statusKey: d.status,
        category: 'Guest',
        visitorType: 'Guest',
        requestedOn: d.createdAt ? toISTDateTimeLabel(d.createdAt) : null,
        unit: { wingName: unitDoc.wingName, unitNumber: unitDoc.unitNumber },
        guest: {
          name: d.guestName,
          countryCode: d.guestCountryCode || '+91',
          phoneNumber: d.guestPhoneNumber,
          imageUrl: d.guestImageUrl || null,
        },
        accompanyingCount: d.accompanyingCount || 0,
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
        status: doc.status === 'approved' ? 'Approved' : 'Rejected',
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
    if (!requestId) return next(createHttpError('requestId is required', 400));

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

module.exports = {
  getRecentGuestsForGuard,
  createGuestEntryRequest,
  getGuestEntryRequestForGuard,
  listGuestEntryRequestsForMember,
  decideGuestEntryRequest,
  allowGuestEntry,
};


