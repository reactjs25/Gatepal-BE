const Maintenance = require('../../model/maintenanceSchema');
const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { buildCanonicalUnitId, assertUnitResidentAccess } = require('../../utils/unitAccess');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const { buildMaintenanceReceiptPdf } = require('../society/maintainanceAdminController');


const formatAmount = (value) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    return Number(value).toFixed(2);
};


const toTitleCase = (str) => {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const ALLOWED_MONTHS = new Set([
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
]);

const toDateOrNull = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
};

const toDateOnly = (value) => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
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

const parseCurrencyAmount = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    const s = normalizeString(value).replace(/[^0-9.]/g, '');
    if (!s) return null;
    const n = Number(s);
    if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) return null;
    return n;
};

const validateUploadPayload = (payload = {}) => {
    const yearRaw = payload.year;
    const year = Math.round(Number(yearRaw));
    if (!Number.isFinite(year) || String(year).length !== 4) {
        throw createHttpError('year must be a 4-digit number.', 400);
    }

    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 2;
    const maxYear = currentYear + 2;
    if (year < minYear || year > maxYear) {
        throw createHttpError(`year must be between ${minYear} and ${maxYear}.`, 400);
    }

    const month = toCanonicalMonth(payload.month);
    if (!month || !ALLOWED_MONTHS.has(month)) {
        throw createHttpError('month must be one of January, February, March, April, May, June, July, August, September, October, November, December.', 400);
    }

    const amount = parseCurrencyAmount(payload.amount);
    if (amount === null) {
        throw createHttpError('amount is required and must be a valid number.', 400);
    }

    const transactionDate = toDateOrNull(payload.transactionDate);
    if (!transactionDate) {
        throw createHttpError('transactionDate is required.', 400);
    }

    const proofImageUrl = ensureBase64ImageDataUrl({ value: payload.proofImageUrl, fieldLabel: 'Proof of Maintenance' });

    return {
        year,
        month,
        amount,
        transactionDate,
        proofImageUrl,
    };
};

const isMemberOrSocietyAdmin = (authUser) =>
    authUser && (authUser.role === 'member' || authUser.role === 'society_admin');

const uploadMaintainanceProof = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized.', 401));
        if (!isMemberOrSocietyAdmin(authUser)) return next(createHttpError('Only members can upload maintenance proof.', 403));
        console.info('[maintainance:upload] invoked', { userId: String(authUser._id) });

          const unitIdCandidate = normalizeString(
            (req.body && req.body.unitId) || (req.params && (req.params.unitId || req.params.id)) || ''
        );

        let unitDoc;
        try {
            unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        } catch (e) {
            return next(e);
        }

        let validated;
        try {
            validated = validateUploadPayload(req.body || {});
        } catch (e) {
            return next(e);
        }

        const canonicalUnitId = buildCanonicalUnitId(unitDoc);

        let society = null;
        try {
            if (unitDoc.societyId) {
                society = await Society.findById(unitDoc.societyId).lean();
            }
        } catch (e) {
            society = null;
        }

        const existing = await Maintenance.findOne({
            unitId: canonicalUnitId,
            year: validated.year,
            month: validated.month,
            deletedAt: null,
        });
        if (existing) {
            const statusLower = String(existing.status || '').toLowerCase();
            if (statusLower === 'rejected') {
                existing.deletedAt = new Date();
                await existing.save();
            } else {
                return next(
                    createHttpError(
                        'A maintenance proof for the specificed month already exists for the unit.',
                        409
                    )
                );
            }
        }

        const doc = await Maintenance.create({
            unitId: canonicalUnitId,
            memberId: authUser._id,
            year: validated.year,
            month: validated.month,
            amount: validated.amount,
            transactionDate: validated.transactionDate,
            proofImageUrl: validated.proofImageUrl,
            status: 'Uploaded',
        });

        return sendSuccessResponse(res, 201, 'Maintenance proof uploaded successfully.', {
            data: {
                maintenanceId: doc.maintenanceId,
                unitId: String(unitDoc._id),
                unitNumber: unitDoc.unitNumber,
                memberId: String(doc.memberId),
                uploadedByName: toTitleCase(authUser.fullName) || null,
                uploadedByPhone: authUser.phoneNumber || null,
                year: String(doc.year),
                month: doc.month,
                amount: formatAmount(doc.amount),
                transactionDate: toDateOnly(doc.transactionDate),
                proofImageUrl: doc.proofImageUrl,
                status: doc.status,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
            },
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return next(createHttpError('A maintenance proof for the specified month already exists for the unit.', 409));
        }
        return next(setErrorDefaults(error, 'Failed to upload maintenance proof'));
    }
};

const getMaintainancesByUnit = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized.', 401));
        if (!isMemberOrSocietyAdmin(authUser)) return next(createHttpError('Only members can view maintenance.', 403));

        const unitIdCandidate = normalizeString(
            (req.body && req.body.unitId) || (req.params && (req.params.unitId || req.params.id)) || ''
        );

        if (!unitIdCandidate) {
            return next(createHttpError('unitId is required.', 400));
        }

        let unitDoc;
        try {
            unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        } catch (e) {
            return next(e);
        }

        const canonicalUnitId = buildCanonicalUnitId(unitDoc);

        let yearFilter = null;
        if (req.body && req.body.year) {
            const parsedYear = Math.round(Number(req.body.year));
            if (Number.isFinite(parsedYear) && String(parsedYear).length === 4) {
                const currentYear = new Date().getFullYear();
                const minYear = currentYear - 2;
                const maxYear = currentYear + 2;
                if (parsedYear >= minYear && parsedYear <= maxYear) {
                    yearFilter = parsedYear;
                }
            }
        }

        const monthIndex = {
            January: 1,
            February: 2,
            March: 3,
            April: 4,
            May: 5,
            June: 6,
            July: 7,
            August: 8,
            September: 9,
            October: 10,
            November: 11,
            December: 12,
        };

        const query = { unitId: canonicalUnitId, deletedAt: null };
        if (yearFilter) {
            query.year = yearFilter;
        }

        const all = await Maintenance.find(query).lean();

        all.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return (monthIndex[b.month] || 0) - (monthIndex[a.month] || 0);
        });
        const items = all;

        const memberIds = Array.from(new Set(items.map((d) => String(d.memberId))));
        const verifierIds = Array.from(
            new Set(
                items
                    .map((d) => (d.verifiedByUserId ? String(d.verifiedByUserId) : null))
                    .filter((id) => id)
            )
        );
        const rejectorIds = Array.from(
            new Set(
                items
                    .map((d) => (d.rejectedByUserId ? String(d.rejectedByUserId) : null))
                    .filter((id) => id)
            )
        );
        const userIds = Array.from(new Set([...memberIds, ...verifierIds, ...rejectorIds]));
        let users = [];
        if (userIds.length > 0) {
            const User = require('../../model/userSchema');
            users = await User.find(
                { _id: { $in: userIds } },
                { fullName: 1, phoneNumber: 1, role: 1 }
            ).lean();
        }
        const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

        let society = null;
        try {
            if (unitDoc.societyId) {
                society = await Society.findById(unitDoc.societyId).lean();
            }
        } catch (e) {
            society = null;
        }

        const data = await Promise.all(
            items.map(async (doc) => {
                const u = userMap[String(doc.memberId)] || {};
                const verifier = doc.verifiedByUserId ? userMap[String(doc.verifiedByUserId)] || {} : {};
                const rejector = doc.rejectedByUserId ? userMap[String(doc.rejectedByUserId)] || {} : {};
                let receipt = null;
                let receiptDate = null;

                if (society && doc.status === 'Verified' && doc.receiptNumber) {
                    try {
                        const unitLabel = unitDoc.wingName
                            ? `${unitDoc.wingName}-${unitDoc.unitNumber}`
                            : unitDoc.unitNumber;
                        const buffer = await buildMaintenanceReceiptPdf({
                            society,
                            maintenance: doc,
                            unitLabel,
                            ownerName: u.fullName || '',
                            paidByName: u.fullName || '',
                        });
                        receipt = `data:application/pdf;base64,${buffer.toString('base64')}`;
                        receiptDate = doc.verifiedAt || null;
                    } catch (e) {
                        receipt = null;
                        receiptDate = doc.verifiedAt || null;
                    }
                }

                const statusLower = String(doc.status || '').toLowerCase();
                let statusLabel = 'Uploaded';
                if (statusLower === 'verified') {
                    statusLabel = 'Uploaded Verified';
                } else if (statusLower === 'rejected') {
                    statusLabel = 'Uploaded Rejected';
                }

                return {
                    maintenanceId: doc.maintenanceId,
                    unitId: String(unitDoc._id),
                    unitNumber: unitDoc.unitNumber,
                    memberId: String(doc.memberId),
                    uploadedByName: toTitleCase(u.fullName) || null,
                    uploadedByPhone: u.phoneNumber || null,
                    year: String(doc.year),
                    month: doc.month,
                    amount: formatAmount(doc.amount),
                    transactionDate: toDateOnly(doc.transactionDate),
                    proofImageUrl: doc.proofImageUrl,
                    status: statusLabel,
                    uploadedOn: toISTDateTimeLabel(doc.createdAt),
                    verifiedBy: verifier.role || null,
                    verifiedOn: doc.verifiedAt ? toISTDateTimeLabel(doc.verifiedAt) : null,
                    rejectedBy: rejector.role || null,
                    rejectedOn: doc.rejectedAt ? toISTDateTimeLabel(doc.rejectedAt) : null,
                    rejectionReason: doc.rejectionReason || null,
                    rejectionDescription: doc.rejectionDescription || null,
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt,
                    receiptNumber: doc.receiptNumber != null ? String(doc.receiptNumber) : null,
                    receiptDate,
                    receipt,
                };
            })
        );

        return sendSuccessResponse(res, 200, 'Maintenance fetched successfully.', {
            data,
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch maintenance'));
    }
};

const getMaintainanceById = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized.', 401));
        if (!isMemberOrSocietyAdmin(authUser)) return next(createHttpError('Only members can view maintenance.', 403));

        const unitIdCandidate = normalizeString((req.body && req.body.unitId) || '');
        const maintenanceId = normalizeString((req.body && req.body.maintenanceId) || '');

        if (!unitIdCandidate) {
            return next(createHttpError('unitId is required.', 400));
        }
        if (!maintenanceId) {
            return next(createHttpError('maintenanceId is required.', 400));
        }

        let unitDoc;
        try {
            unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        } catch (e) {
            return next(e);
        }

        const canonicalUnitId = buildCanonicalUnitId(unitDoc);

        const doc = await Maintenance.findOne({ maintenanceId }).lean();
        if (!doc) return next(createHttpError('Maintenance not found.', 404));
        if (doc.unitId !== canonicalUnitId) {
            return next(createHttpError('Maintenance does not belong to the provided unit.', 403));
        }
        if (doc.deletedAt) {
            return next(createHttpError('Maintenance not found.', 404));
        }

        const User = require('../../model/userSchema');
        const uploader = await User.findById(doc.memberId, { fullName: 1, phoneNumber: 1 }).lean();

        let society = null;
        try {
            if (unitDoc.societyId) {
                society = await Society.findById(unitDoc.societyId).lean();
            }
        } catch (e) {
            society = null;
        }

        let receipt = null;
        let receiptDate = null;
        if (society && doc.status === 'Verified' && doc.receiptNumber) {
            try {
                const unitLabel = unitDoc.wingName
                    ? `${unitDoc.wingName}-${unitDoc.unitNumber}`
                    : unitDoc.unitNumber;
                const buffer = await buildMaintenanceReceiptPdf({
                    society,
                    maintenance: doc,
                    unitLabel,
                    ownerName: uploader ? uploader.fullName || '' : '',
                    paidByName: uploader ? uploader.fullName || '' : '',
                });
                receipt = `data:application/pdf;base64,${buffer.toString('base64')}`;
                receiptDate = doc.verifiedAt || null;
            } catch (e) {
                receipt = null;
                receiptDate = doc.verifiedAt || null;
            }
        }

        return sendSuccessResponse(res, 200, 'Maintenance fetched successfully.', {
            data: {
                maintenanceId: doc.maintenanceId,
                unitId: String(unitDoc._id),
                unitNumber: unitDoc.unitNumber,
                memberId: String(doc.memberId),
                uploadedByName: toTitleCase(uploader ? uploader.fullName : null) || null,
                uploadedByPhone: uploader ? uploader.phoneNumber || null : null,
                year: String(doc.year),
                month: doc.month,
                amount: formatAmount(doc.amount),
                transactionDate: toDateOnly(doc.transactionDate),
                proofImageUrl: doc.proofImageUrl,
                status: doc.status,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                uploadedOn: toISTDateTimeLabel(doc.createdAt),
                receiptNumber: doc.receiptNumber != null ? String(doc.receiptNumber) : null,
                receiptDate,
                receipt,
            },
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch maintenance'));
    }
};

module.exports = {
    uploadMaintainanceProof,
    getMaintainancesByUnit,
    getMaintainanceById,
};

