const Maintenance = require('../../model/maintenanceSchema');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { toDateOnly, toISTDateLabel, toISTDateTimeLabel } = require('../../utils/dateTime');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');

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

const toCanonicalMonth = (value) => {
  const v = normalizeString(value).toLowerCase();
  if (!v) return '';
  const map = {
    january: 'January',
    february: 'February',
    march: 'March',
    april: 'April',
    may: 'May',
    june: 'June',
    july: 'July',
    august: 'August',
    september: 'September',
    october: 'October',
    november: 'November',
    december: 'December',
  };
  return map[v] || '';
};

const toCanonicalMonthLabel = (value) => {
  const s = normalizeString(value);
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length < 2) return '';
  const m = toCanonicalMonth(parts[0]);
  const y = Math.round(Number(parts[parts.length - 1]));
  if (!m || !Number.isFinite(y) || String(y).length !== 4) return '';
  return `${m} ${y}`;
};

const getMaintenanceYearlySummary = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const year = Math.round(Number((req.query && req.query.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number', 400));
    }

    const wings = Array.isArray(society.structure) ? society.structure : [];
    const totalUnits = wings.reduce((sum, w) => {
      const units = Array.isArray(w.units) ? w.units.length : 0;
      const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
      return sum + (declared || units);
    }, 0);

    const occupants = await MemberUnit.find(
      { societyId: society._id },
      { wingNameLower: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
    ).lean();
    const unitGroups = occupants.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const groupKeys = Object.keys(unitGroups);
    const classify = (items) => {
      const types = new Set(items.map((x) => x.occupantType));
      const statuses = new Set(items.map((x) => x.occupancyStatus));
      if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) return 'tenant';
      if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) return 'vacant';
      if (types.has('unit_owner') || types.has('unit_owner_family_member')) return 'owner';
      return 'owner';
    };

    const ownerUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'owner');
    const tenantUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'tenant');
    const occupiedCount = ownerUnitKeys.length + tenantUnitKeys.length;
    const vacantCount = Math.max(0, totalUnits - occupiedCount);

    const prefix = `${String(society._id)}:`;
    const maintDocsYear = await Maintenance.find(
      { unitId: { $regex: `^${prefix}` }, year, deletedAt: null },
      { unitId: 1, month: 1, status: 1 }
    ).lean();

    const docsByMonth = maintDocsYear.reduce((acc, d) => {
      const m = d.month || '';
      if (!acc[m]) acc[m] = [];
      acc[m].push(d);
      return acc;
    }, {});

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    const data = MONTH_LABELS.map((month) => {
      const maintDocs = docsByMonth[month] || [];

      const statusMap = maintDocs.reduce((acc, d) => {
        const p = parseUnit(d.unitId);
        const key = `${p.wingLower}:${p.unitLower}`;
        const s = normalizeString(d.status).toLowerCase();
        const canonical = s === 'verified' ? 'verified' : s === 'rejected' ? 'rejected' : 'uploaded';
        acc[key] = canonical;
        return acc;
      }, {});

      let owner = { totalUnits: ownerUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };
      let tenant = { totalUnits: tenantUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };

      for (const key of ownerUnitKeys) {
        const st = statusMap[key];
        if (!st) owner.pending += 1; else if (st === 'verified') owner.verified += 1; else if (st === 'rejected') owner.rejected += 1; else owner.uploaded += 1;
      }
      for (const key of tenantUnitKeys) {
        const st = statusMap[key];
        if (!st) tenant.pending += 1; else if (st === 'verified') tenant.verified += 1; else if (st === 'rejected') tenant.rejected += 1; else tenant.uploaded += 1;
      }

      const totals = maintDocs.reduce(
        (acc, d) => {
          const s = normalizeString(d.status).toLowerCase();
          if (s === 'verified') acc.verified += 1; else if (s === 'rejected') acc.rejected += 1; else acc.uploaded += 1;
          return acc;
        },
        { pending: owner.pending + tenant.pending, uploaded: 0, verified: 0, rejected: 0 }
      );

      const pendingUnits = owner.pending + tenant.pending;
      const uploaded = totals.uploaded;
      const verified = totals.verified;
      const rejected = totals.rejected;

      let status = 'Pending';
      if (uploaded === 0 && pendingUnits === 0 && (verified + rejected > 0)) {
        status = 'Completed';
      } else if (verified === 0 && rejected === 0 && uploaded === 0) {
        status = 'Pending';
      } else {
        status = 'Partial';
      }

      const statusTag = status === 'Completed' ? 'Completed' : `${pendingUnits} Pending`;

      return {
        month,
        year,
        monthLabel: `${month} ${year}`,
        status,
        statusTag,
        counts: {
          pendingUnits,
          uploaded,
          verified,
          rejected,
          totalUnits,
          vacantUnits: vacantCount,
        },
      };
    });

    return sendSuccessResponse(res, 200, 'Maintenance yearly summary fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance yearly summary'));
  }
};

const getMaintenanceSummaryByMonth = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const monthRaw = (req.body && req.body.month) || '';
    const month = toCanonicalMonth(monthRaw);
    if (!month) return next(createHttpError('Invalid month', 400));
    const year = Math.round(Number((req.body && req.body.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number', 400));
    }

    const wings = Array.isArray(society.structure) ? society.structure : [];
    const totalUnits = wings.reduce((sum, w) => {
      const units = Array.isArray(w.units) ? w.units.length : 0;
      const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
      return sum + (declared || units);
    }, 0);

    const occupants = await MemberUnit.find(
      { societyId: society._id },
      { wingNameLower: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
    ).lean();
    const unitGroups = occupants.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const groupKeys = Object.keys(unitGroups);
    const classify = (items) => {
      const types = new Set(items.map((x) => x.occupantType));
      const statuses = new Set(items.map((x) => x.occupancyStatus));
      if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) return 'tenant';
      if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) return 'vacant';
      if (types.has('unit_owner') || types.has('unit_owner_family_member')) return 'owner';
      return 'owner';
    };

    const ownerUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'owner');
    const tenantUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'tenant');
    const occupiedCount = ownerUnitKeys.length + tenantUnitKeys.length;
    const vacantCount = Math.max(0, totalUnits - occupiedCount);

    const prefix = `${String(society._id)}:`;
    const maintDocs = await Maintenance.find({ unitId: { $regex: `^${prefix}` }, month, year, deletedAt: null }, { unitId: 1, status: 1 }).lean();
    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const statusMap = maintDocs.reduce((acc, d) => {
      const p = parseUnit(d.unitId);
      const key = `${p.wingLower}:${p.unitLower}`;
      const s = normalizeString(d.status).toLowerCase();
      const canonical = s === 'verified' ? 'verified' : s === 'rejected' ? 'rejected' : 'uploaded';
      acc[key] = canonical;
      return acc;
    }, {});

    let owner = { totalUnits: ownerUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };
    let tenant = { totalUnits: tenantUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };

    for (const key of ownerUnitKeys) {
      const st = statusMap[key];
      if (!st) owner.pending += 1; else if (st === 'verified') owner.verified += 1; else if (st === 'rejected') owner.rejected += 1; else owner.uploaded += 1;
    }
    for (const key of tenantUnitKeys) {
      const st = statusMap[key];
      if (!st) tenant.pending += 1; else if (st === 'verified') tenant.verified += 1; else if (st === 'rejected') tenant.rejected += 1; else tenant.uploaded += 1;
    }

    const totals = maintDocs.reduce(
      (acc, d) => {
        const s = normalizeString(d.status).toLowerCase();
        if (s === 'verified') acc.verified += 1; else if (s === 'rejected') acc.rejected += 1; else acc.uploaded += 1;
        return acc;
      },
      { pending: owner.pending + tenant.pending, uploaded: 0, verified: 0, rejected: 0 }
    );

    const totalPending = owner.pending + tenant.pending;

    return sendSuccessResponse(res, 200, 'Maintenance summary fetched successfully', {
      data: {
        monthLabel: `${month} ${year}`,
        societyId: String(society._id),
        totalPendingCount: `${totalPending} Pending`,
        pendingCount: {
          ownerPendingCount: `${owner.pending} Pending`,
          tenantPendingCount: tenant.pending,
          vacantCount: `${vacantCount} Vacant`,
        },
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance summary'));
  }
};

const listUploadedMaintenanceByMonth = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const monthRaw = (req.body && req.body.month) || '';
    const month = toCanonicalMonth(monthRaw);
    if (!month) return next(createHttpError('Invalid month parameter', 400));
    const year = Math.round(Number((req.body && req.body.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number', 400));
    }

    const statusRaw = normalizeString((req.body && req.body.status) || '');
    let statusQuery = null;
    let includePendingMissing = false;
    if (statusRaw) {
      const s = statusRaw.toLowerCase();
      if (s === 'pending') {
        includePendingMissing = true;
        statusQuery = { $in: ['Uploaded'] };
      } else {
        const statusCanonicalMap = { uploaded: 'UPLOADED', verified: 'VERIFIED', rejected: 'REJECTED' };
        const canonical = statusCanonicalMap[s] || null;
        if (!canonical) return next(createHttpError('Invalid status parameter', 400));
        const legacyMap = { UPLOADED: 'Uploaded', VERIFIED: 'Verified', REJECTED: 'Rejected' };
        statusQuery = { $in: [canonical, legacyMap[canonical]] };
      }
    }

    const prefix = `${String(society._id)}:`;
    const baseQuery = {
      unitId: { $regex: `^${prefix}` },
      month,
      year,
      deletedAt: null,
    };
    if (statusQuery) {
      baseQuery.status = statusQuery;
    } else {
      baseQuery.$or = [
        { status: { $in: ['UPLOADED', 'Uploaded'] } },
        { status: { $exists: false } },
        { status: null },
      ];
    }

    const items = await Maintenance.find(baseQuery)
      .sort({ createdAt: -1 })
      .lean();

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    let unitDocs = [];
    if (includePendingMissing) {
      unitDocs = await MemberUnit.find(
        { societyId: society._id },
        {
          wingName: 1,
          wingNameLower: 1,
          unitNumber: 1,
          unitNumberLower: 1,
          occupantType: 1,
          occupancyStatus: 1,
          memberId: 1,
        }
      ).lean();
    } else {
      const unitKeys = Array.from(
        new Set(items.map((m) => {
          const p = parseUnit(m.unitId);
          return `${p.wingLower}:${p.unitLower}`;
        }))
      );
      const unitQueryOr = unitKeys.map((key) => {
        const [wingLower, unitLower] = key.split(':');
        return { societyId: society._id, wingNameLower: wingLower, unitNumberLower: unitLower };
      });
      if (unitQueryOr.length > 0) {
        unitDocs = await MemberUnit.find(
          { $or: unitQueryOr },
          {
            wingName: 1,
            wingNameLower: 1,
            unitNumber: 1,
            unitNumberLower: 1,
            occupantType: 1,
            occupancyStatus: 1,
            memberId: 1,
          }
        ).lean();
      }
    }
    const unitGroups = unitDocs.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const uploaderIds = Array.from(new Set(items.map((m) => String(m.memberId))));
    const ownerIds = [];
    for (const key of Object.keys(unitGroups)) {
      const owner = unitGroups[key].find(
        (u) => u.occupantType === 'unit_owner' && u.occupancyStatus === 'currently_residing'
      );
      if (owner) ownerIds.push(String(owner.memberId));
    }
    const userIds = Array.from(new Set([...uploaderIds, ...ownerIds]));
    const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }, { fullName: 1, phoneNumber: 1 }).lean() : [];
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const dataUploaded = items.map((doc) => {
      const p = parseUnit(doc.unitId);
      const key = `${p.wingLower}:${p.unitLower}`;
      const group = unitGroups[key] || [];

      const primaryUnit =
        group.find((u) => u.occupantType === 'unit_owner') ||
        group.find((u) => u.occupantType === 'tenant') ||
        group[0] ||
        null;

      const unitNumber = primaryUnit ? primaryUnit.unitNumber : null;
      const categoryLabel = primaryUnit
        ? primaryUnit.occupantType === 'unit_owner'
          ? 'Owner'
          : primaryUnit.occupantType === 'tenant'
          ? 'Tenant'
          : ''
        : '';

      const ownerLiving =
        group.find(
          (u) => u.occupantType === 'unit_owner' && u.occupancyStatus === 'currently_residing'
        ) || null;
      const ownerUser = ownerLiving ? userMap[String(ownerLiving.memberId)] || {} : {};

      if (includePendingMissing) {
        return {
          unitId: primaryUnit ? String(primaryUnit._id) : null,
          monthLabel: `${month} ${year}`,
          unitNumber,
          unitCategory: categoryLabel || null,
          ownerName: ownerUser.fullName || '',
        };
      }

      return {
        maintenanceId: doc.maintenanceId,
        unitId: primaryUnit ? String(primaryUnit._id) : null,
        monthLabel: `${month} ${year}`,
        unitNumber,
        unitCategory: categoryLabel || null,
        ownerName: ownerUser.fullName || '',
        amount: doc.amount,
        transactionDate: toDateOnly(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: (userMap[String(doc.memberId)] || {}).fullName || null,
      };
    });

    let data = dataUploaded;
    if (includePendingMissing) {
      const presentKeys = new Set(items.map((m) => {
        const p = parseUnit(m.unitId);
        return `${p.wingLower}:${p.unitLower}`;
      }));
      const allKeys = Object.keys(unitGroups);
      const missingKeys = allKeys.filter((k) => {
        const g = unitGroups[k] || [];
        const ownerUnit = g.find((u) => u.occupantType === 'unit_owner') || g.find((u) => u.occupantType === 'tenant') || null;
        return ownerUnit && !presentKeys.has(k);
      });
      const synthetic = missingKeys.map((key) => {
        const g = unitGroups[key] || [];
        const ownerUnit = g.find((u) => u.occupantType === 'unit_owner') || g.find((u) => u.occupantType === 'tenant') || null;
        const unitNumber = ownerUnit ? ownerUnit.unitNumber : null;
        const categoryLabel = ownerUnit ? (ownerUnit.occupantType === 'unit_owner' ? 'Owner' : ownerUnit.occupantType === 'tenant' ? 'Tenant' : '') : '';
        const ownerUser = ownerUnit ? userMap[String(ownerUnit.memberId)] || {} : {};
        return {
          unitId: ownerUnit ? String(ownerUnit._id) : null,
          monthLabel: `${month} ${year}`,
          unitNumber,
          unitCategory: categoryLabel || null,
          ownerName: ownerUser.fullName || null,
        };
      });
      data = synthetic;
    }

    return sendSuccessResponse(res, 200, 'Maintenance uploads fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance uploads'));
  }
};

const verifyMaintenance = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const maintenanceId = normalizeString((req.body && req.body.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId is required', 400));

    const doc = await Maintenance.findOne({ maintenanceId });
    if (!doc) return next(createHttpError('Maintenance not found', 404));

    const prefix = `${String(society._id)}:`;
    if (!String(doc.unitId).startsWith(prefix)) {
      return next(createHttpError('Maintenance does not belong to this society', 403));
    }

    if (doc.deletedAt) return next(createHttpError('Maintenance not found', 404));
    if (doc.status && doc.status.toLowerCase() === 'verified') {
      return next(createHttpError('Maintenance already verified', 409));
    }
    if (doc.status && doc.status.toLowerCase() === 'rejected') {
      return next(createHttpError('Maintenance is rejected and cannot be verified', 409));
    }

    const { unitWing, unitNumber, unitCategory, ownerName, amount, transactionDate, uploadedBy, proofImageUrl, uploadedOn, monthLabel } = req.body || {};

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const parsed = parseUnit(doc.unitId);
    const unitDocs = await MemberUnit.find(
      { societyId: parsed.societyId, wingNameLower: parsed.wingLower, unitNumberLower: parsed.unitLower },
      { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, memberId: 1 }
    ).lean();
    const ownerUnit = unitDocs.find((u) => u.occupantType === 'unit_owner') || unitDocs.find((u) => u.occupantType === 'tenant') || null;
    const expectedWing = ownerUnit ? ownerUnit.wingName : null;
    const expectedNumber = ownerUnit ? ownerUnit.unitNumber : null;
    const expectedCategory = ownerUnit ? (ownerUnit.occupantType === 'unit_owner' ? 'Owner' : ownerUnit.occupantType === 'tenant' ? 'Tenant' : '') : '';

    const User = require('../../model/userSchema');
    const ownerUser = ownerUnit ? await User.findById(ownerUnit.memberId, { fullName: 1 }).lean() : null;
    const uploaderUser = await User.findById(doc.memberId, { fullName: 1 }).lean();

    if (unitWing !== undefined && normalizeString(unitWing) !== normalizeString(expectedWing)) {
      return next(createHttpError('Payload unitWing does not match record', 409));
    }
    if (unitNumber !== undefined && normalizeString(unitNumber) !== normalizeString(expectedNumber)) {
      return next(createHttpError('Payload unitNumber does not match record', 409));
    }
    if (unitCategory !== undefined && normalizeString(unitCategory) !== normalizeString(expectedCategory)) {
      return next(createHttpError('Payload unitCategory does not match record', 409));
    }
    if (ownerName !== undefined && normalizeString(ownerName) !== normalizeString(ownerUser ? ownerUser.fullName : '')) {
      return next(createHttpError('Payload ownerName does not match record', 409));
    }
    if (amount !== undefined && Number(amount) !== doc.amount) {
      return next(createHttpError('Payload amount does not match record', 409));
    }
    if (transactionDate !== undefined) {
      const txDatePayload = new Date(transactionDate);
      if (Number.isNaN(txDatePayload.getTime())) {
        return next(createHttpError('transactionDate must be a valid date', 400));
      }
      const toDateOnlyStr = (d) => new Date(d).toISOString().split('T')[0];
      if (toDateOnlyStr(txDatePayload) !== toDateOnlyStr(doc.transactionDate)) {
        return next(createHttpError('Payload transactionDate does not match record', 409));
      }
    }
    if (uploadedBy !== undefined && normalizeString(uploadedBy) !== normalizeString(uploaderUser ? uploaderUser.fullName : '')) {
      return next(createHttpError('Payload uploadedBy does not match record', 409));
    }

    if (!proofImageUrl) {
      return next(createHttpError('proofImageUrl is required', 400));
    }
    const formattedProof = ensureBase64ImageDataUrl({ value: proofImageUrl, fieldLabel: 'Proof of Maintenance' });
    if (normalizeString(formattedProof) !== normalizeString(doc.proofImageUrl)) {
      return next(createHttpError('Payload proofImageUrl does not match record', 409));
    }
    if (!uploadedOn) {
      return next(createHttpError('uploadedOn is required', 400));
    }
    const expectedUploadedOn = toISTDateTimeLabel(doc.createdAt);
    if (normalizeString(uploadedOn) !== normalizeString(expectedUploadedOn)) {
      return next(createHttpError('Payload uploadedOn does not match record', 409));
    }
    if (!monthLabel) {
      return next(createHttpError('monthLabel is required', 400));
    }
    const canonicalPayloadMonthLabel = toCanonicalMonthLabel(monthLabel);
    const canonicalExpectedMonthLabel = `${doc.month} ${doc.year}`;
    if (canonicalPayloadMonthLabel !== canonicalExpectedMonthLabel) {
      return next(createHttpError('Payload monthLabel does not match record', 409));
    }

    doc.status = 'Verified';
    doc.verifiedAt = new Date();
    doc.verifiedByUserId = authUser._id || null;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Maintenance verified successfully', {
      data: {
        maintenanceId: doc.maintenanceId,
        monthLabel: `${doc.month} ${doc.year}`,
        unitNumber: expectedNumber,
        unitCategory: expectedCategory || null,
        ownerName: ownerUser ? ownerUser.fullName : null,
        amount: doc.amount,
        transactionDate: toDateOnly(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: uploaderUser ? uploaderUser.fullName : null,

      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to verify maintenance'));
  }
};

const rejectMaintenance = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const maintenanceId = normalizeString((req.body && req.body.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId is required', 400));

    const { unitId, rejectReason, description } = req.body || {};
    const reason = normalizeString(rejectReason);
    if (!reason) return next(createHttpError('rejectReason is required', 400));
    const allowed = new Set(['Invalid Proof', 'Amount Mismatch', 'Wrong Month', 'Not Society Payment', 'Duplicate', 'other']);
    if (!allowed.has(reason)) return next(createHttpError('Invalid rejectReason', 400));
    if (reason === 'other') {
      const desc = normalizeString(description);
      if (!desc) return next(createHttpError('description is required when rejectReason is Other', 400));
    }

    const doc = await Maintenance.findOne({ maintenanceId });
    if (!doc) return next(createHttpError('Maintenance not found', 404));

    const prefix = `${String(society._id)}:`;
    if (!String(doc.unitId).startsWith(prefix)) {
      return next(createHttpError('Maintenance does not belong to this society', 403));
    }
    if (doc.deletedAt) return next(createHttpError('Maintenance not found', 404));
    if (doc.status && doc.status.toLowerCase() === 'verified') {
      return next(createHttpError('Verified maintenance cannot be rejected', 409));
    }
    if (doc.status && doc.status.toLowerCase() === 'rejected') {
      return next(createHttpError('Maintenance already rejected', 409));
    }

    if (!unitId) return next(createHttpError('unitId is required', 400));
    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const parsed = parseUnit(doc.unitId);
    const unitDocs = await MemberUnit.find({ societyId: parsed.societyId, wingNameLower: parsed.wingLower, unitNumberLower: parsed.unitLower }, { _id: 1, wingName: 1, unitNumber: 1, occupantType: 1, memberId: 1 }).lean();
    const acceptableUnitIds = new Set([String(doc.unitId)]);
    for (const u of unitDocs) acceptableUnitIds.add(String(u._id));
    if (!acceptableUnitIds.has(String(unitId))) {
      return next(createHttpError('unitId does not match record', 409));
    }

    doc.status = 'Rejected';
    doc.rejectedAt = new Date();
    doc.rejectedByUserId = authUser._id || null;
    doc.rejectionReason = reason;
    doc.rejectionDescription = reason === 'Other' ? normalizeString(description) : null;
    await doc.save();

    const User = require('../../model/userSchema');
    const uploaderUser = await User.findById(doc.memberId, { fullName: 1 }).lean();
    const primaryUnitDoc = unitDocs.find((u) => u.occupantType === 'unit_owner') || unitDocs.find((u) => u.occupantType === 'tenant') || unitDocs[0] || null;

    return sendSuccessResponse(res, 200, 'Maintenance rejected successfully', {
      data: {
        maintenanceId: doc.maintenanceId,
        monthLabel: `${doc.month} ${doc.year}`,
        unitWing: primaryUnitDoc ? primaryUnitDoc.wingName : null,
        unitNumber: primaryUnitDoc ? primaryUnitDoc.unitNumber : null,
        unitLabel: primaryUnitDoc ? `${primaryUnitDoc.wingName} ${primaryUnitDoc.unitNumber}` : null,
        unitCategory: primaryUnitDoc ? (primaryUnitDoc.occupantType === 'unit_owner' ? 'Owner' : primaryUnitDoc.occupantType === 'tenant' ? 'Tenant' : '') : null,
        amount: doc.amount,
        transactionDate: toDateOnly(doc.transactionDate),
        transactionDateIst: toISTDateLabel(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: uploaderUser ? uploaderUser.fullName : null,
        rejectedAt: doc.rejectedAt,
        rejectedByUserId: doc.rejectedByUserId ? String(doc.rejectedByUserId) : null,
        rejectionReason: doc.rejectionReason,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to reject maintenance'));
  }
};

module.exports = {
  getMaintenanceYearlySummary,
  listUploadedMaintenanceByMonth,
  getMaintenanceSummaryByMonth,
  verifyMaintenance,
  rejectMaintenance,
};
