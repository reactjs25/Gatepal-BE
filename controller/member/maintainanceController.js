const Maintenance = require('../../model/maintenanceSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const { buildCanonicalUnitId, assertUnitResidentAccess } = require('../../utils/unitAccess');
const { toISTDateTimeLabel } = require('../../utils/dateTime');

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
        throw createHttpError('year must be a 4-digit number', 400);
    }

    const month = toCanonicalMonth(payload.month);
    if (!month || !ALLOWED_MONTHS.has(month)) {
        throw createHttpError('month must be one of January, February, March, April, May, June, July, August, September, October, November, December', 400);
    }

    const amount = parseCurrencyAmount(payload.amount);
    if (amount === null) {
        throw createHttpError('amount is required and must be a valid number', 400);
    }

    const transactionDate = toDateOrNull(payload.transactionDate);
    if (!transactionDate) {
        throw createHttpError('transactionDate is required', 400);
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

const uploadMaintainanceProof = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized', 401));
        if (authUser.role !== 'member') return next(createHttpError('Only members can upload maintenance proof', 403));
        console.info('[maintainance:upload] invoked', { userId: String(authUser._id) });

        const unitIdCandidate = normalizeString(
            (req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId
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

        const exists = await Maintenance.exists({ unitId: canonicalUnitId, year: validated.year, month: validated.month, deletedAt: null });
        if (exists) {
            return next(createHttpError('A maintenance proof for the specified month already exists for the unit', 409));
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

        return sendSuccessResponse(res, 201, 'Maintenance proof uploaded successfully', {
            data: {
                maintenanceId: doc.maintenanceId,
                unitId: String(unitDoc._id),
                unitNumber: unitDoc.unitNumber,
                memberId: String(doc.memberId),
                uploadedByName: authUser.fullName || null,
                uploadedByPhone: authUser.phoneNumber || null,
                year: doc.year,
                month: doc.month,
                amount: doc.amount,
                transactionDate: toDateOnly(doc.transactionDate),
                proofImageUrl: doc.proofImageUrl,
                status: doc.status,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
            },
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return next(createHttpError('A maintenance proof for the specified month already exists for the unit', 409));
        }
        return next(setErrorDefaults(error, 'Failed to upload maintenance proof'));
    }
};

const getMaintainancesByUnit = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized', 401));
        if (authUser.role !== 'member') return next(createHttpError('Only members can view maintenance', 403));

        const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');

        let unitDoc;
        try {
            unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        } catch (e) {
            return next(e);
        }

        const canonicalUnitId = buildCanonicalUnitId(unitDoc);

        const page = Math.max(1, Number((req.query && req.query.page) || 1));
        const limit = Math.max(1, Math.min(100, Number((req.query && req.query.limit) || 10)));
        const skip = (page - 1) * limit;

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

        const [all, total] = await Promise.all([
            Maintenance.find({ unitId: canonicalUnitId, deletedAt: null }).lean(),
            Maintenance.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
        ]);

        all.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return (monthIndex[b.month] || 0) - (monthIndex[a.month] || 0);
        });

        const items = all.slice(skip, skip + limit);

        const memberIds = Array.from(new Set(items.map((d) => String(d.memberId))));
        let users = [];
        if (memberIds.length > 0) {
            const User = require('../../model/userSchema');
            users = await User.find({ _id: { $in: memberIds } }, { fullName: 1, phoneNumber: 1 }).lean();
        }
        const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

        return sendSuccessResponse(res, 200, 'Maintenance fetched successfully', {
            data: items.map((doc) => {
                const u = userMap[String(doc.memberId)] || {};
                return {
                    maintenanceId: doc.maintenanceId,
                    unitId: String(unitDoc._id),
                    unitNumber: unitDoc.unitNumber,
                    memberId: String(doc.memberId),
                    uploadedByName: u.fullName || null,
                    uploadedByPhone: u.phoneNumber || null,
                    year: doc.year,
                    month: doc.month,
                    amount: doc.amount,
                    transactionDate: toDateOnly(doc.transactionDate),
                    proofImageUrl: doc.proofImageUrl,
                    status: doc.status,
                    uploadedOn: toISTDateTimeLabel(doc.createdAt),
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt,

                };
            }),
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch maintenance'));
    }
};

const getMaintainanceById = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) return next(createHttpError('Unauthorized', 401));
        if (authUser.role !== 'member') return next(createHttpError('Only members can view maintenance', 403));

        const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
        const maintenanceId = normalizeString((req.params && req.params.maintenanceId) || '');
        if (!maintenanceId) return next(createHttpError('maintenanceId path parameter is required', 400));

        let unitDoc;
        try {
            unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        } catch (e) {
            return next(e);
        }

        const canonicalUnitId = buildCanonicalUnitId(unitDoc);

        const doc = await Maintenance.findOne({ maintenanceId }).lean();
        if (!doc) return next(createHttpError('Maintenance not found', 404));
        if (doc.unitId !== canonicalUnitId) {
            return next(createHttpError('Maintenance does not belong to the provided unit', 403));
        }
        if (doc.deletedAt) {
            return next(createHttpError('Maintenance not found', 404));
        }

        const User = require('../../model/userSchema');
        const uploader = await User.findById(doc.memberId, { fullName: 1, phoneNumber: 1 }).lean();

        return sendSuccessResponse(res, 200, 'Maintenance fetched successfully', {
            data: {
                maintenanceId: doc.maintenanceId,
                unitId: String(unitDoc._id),
                unitNumber: unitDoc.unitNumber,
                memberId: String(doc.memberId),
                uploadedByName: uploader ? uploader.fullName || null : null,
                uploadedByPhone: uploader ? uploader.phoneNumber || null : null,
                year: doc.year,
                month: doc.month,
                amount: doc.amount,
                transactionDate: toDateOnly(doc.transactionDate),
                proofImageUrl: doc.proofImageUrl,
                status: doc.status,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                uploadedOn: toISTDateTimeLabel(doc.createdAt),
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

