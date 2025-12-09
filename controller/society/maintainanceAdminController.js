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

const listUploadedMaintenanceByMonth = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const monthRaw = (req.params && req.params.month) || '';
    const month = toCanonicalMonth(monthRaw);
    if (!month) return next(createHttpError('Invalid month parameter', 400));
    const year = Math.round(Number((req.query && req.query.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number', 400));
    }

    const statusRaw = normalizeString((req.query && req.query.status) || '');
    let statusQuery = null;
    if (statusRaw) {
      const statusCanonicalMap = { uploaded: 'UPLOADED', verified: 'VERIFIED', rejected: 'REJECTED' };
      const canonical = statusCanonicalMap[statusRaw.toLowerCase()] || null;
      if (!canonical) return next(createHttpError('Invalid status parameter', 400));
      const legacyMap = { UPLOADED: 'Uploaded', VERIFIED: 'Verified', REJECTED: 'Rejected' };
      statusQuery = { $in: [canonical, legacyMap[canonical]] };
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

    let unitDocs = [];
    if (unitQueryOr.length > 0) {
      unitDocs = await MemberUnit.find(
        { $or: unitQueryOr },
        { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, memberId: 1 }
      ).lean();
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
      const owner = unitGroups[key].find((u) => u.occupantType === 'unit_owner') || unitGroups[key].find((u) => u.occupantType === 'tenant') || null;
      if (owner) ownerIds.push(String(owner.memberId));
    }
    const userIds = Array.from(new Set([...uploaderIds, ...ownerIds]));
    const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }, { fullName: 1, phoneNumber: 1 }).lean() : [];
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const data = items.map((doc) => {
      const p = parseUnit(doc.unitId);
      const key = `${p.wingLower}:${p.unitLower}`;
      const group = unitGroups[key] || [];
      const ownerUnit = group.find((u) => u.occupantType === 'unit_owner') || group.find((u) => u.occupantType === 'tenant') || null;
      const unitWing = ownerUnit ? ownerUnit.wingName : null;
      const unitNumber = ownerUnit ? ownerUnit.unitNumber : null;
      const unitLabel = unitWing && unitNumber ? `${unitWing} ${unitNumber}` : null;
      const categoryLabel = ownerUnit ? (ownerUnit.occupantType === 'unit_owner' ? 'Owner' : ownerUnit.occupantType === 'tenant' ? 'Tenant' : '') : '';
      const ownerUser = ownerUnit ? userMap[String(ownerUnit.memberId)] || {} : {};
      const uploaderUser = userMap[String(doc.memberId)] || {};

      return {
        maintenanceId: doc.maintenanceId,
        unitId: ownerUnit ? String(ownerUnit._id) : null,
        monthLabel: `${month} ${year}`,
        unitNumber,
        unitCategory: categoryLabel || null,
        ownerName: ownerUser.fullName || null,
        amount: doc.amount,
        transactionDate: toDateOnly(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: uploaderUser.fullName || null,
      };
    });

    return sendSuccessResponse(res, 200, 'Maintenance uploads fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance uploads'));
  }
};

const verifyMaintenance = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(authUser);

    const maintenanceId = normalizeString((req.params && req.params.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId path parameter is required', 400));

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

    const maintenanceId = normalizeString((req.params && req.params.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId path parameter is required', 400));

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
  listUploadedMaintenanceByMonth,
  verifyMaintenance,
  rejectMaintenance,
};
