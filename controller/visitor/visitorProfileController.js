const QRCode = require('qrcode');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { toTitleCaseName, normalizeString } = require('../../utils/strings');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const User = require('../../model/userSchema');
const SuperAdmin = require('../../model/superAdminSchema');
const DeliveryCompany = require('../../model/deliveryCompanySchema');
const TaxiDriverCompany = require('../../model/taxiDriverCompanySchema');
const OtherVisitorCompany = require('../../model/otherVisitorCompanySchema');
const { getOtherVisitorCompanyInfo } = require('../../utils/otherVisitorCompanies');
const { getTaxiCompanyInfo } = require('../../utils/taxiDriverCompanies');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

const toVisitorTypeLabel = (visitorType) => {
    const raw = (visitorType || '').toString().trim();
    if (!raw) return null;
    return toTitleCaseName(raw.replace(/_/g, ' '));
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCompanyId = (name) =>
    (name || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const resolveCompanyLogo = async (visitorType, companyName) => {
    const trimmed = (companyName || '').toString().trim();
    if (!trimmed) {
        return null;
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

const buildVisitorQrPayload = (user) =>
    JSON.stringify({
        type: 'gatepal_visitor',
        version: 1,
        userId: String(user._id),
        role: user.role,
        visitorType: user.visitorType || null,
        fullName: user.fullName || null,
        phoneNumber: user.phoneNumber || null,
    });

const ensureVisitorQrCode = async (user) => {
    let qrCodeImageUrl = user.qrCodeImage || null;
    if (!qrCodeImageUrl) {
        try {
            const payload = buildVisitorQrPayload(user);
            qrCodeImageUrl = await QRCode.toDataURL(payload, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 256,
            });
            user.qrCodeImage = qrCodeImageUrl;
            user.qrCodeGeneratedAt = new Date();
            await user.save();
        } catch (e) {
            qrCodeImageUrl = null;
        }
    }
    return qrCodeImageUrl;
};

const buildVisitorProfileResponse = (user, options = {}) => {
    const includeQr = options.includeQr === true;
    const companyLogo = options.companyLogo !== undefined ? options.companyLogo : null;
    return {
        id: String(user._id),
        name: user.fullName || null,
        visitorType: user.visitorType || null,
        visitorTypeLabel: toVisitorTypeLabel(user.visitorType),
        countryCode: user.countryCode || '+91',
        phoneNumber: user.phoneNumber || null,
        companyName: user.visitorCompanyName || null,
        companyLogo,
        subCategory: user.visitorWorkCategory || null,
        vehicleNumber: user.visitorVehicleNumber || null,
        imageUrl: user.profilePhoto || null,
        message:
            'Hello, our society is using GatePal™ app to manage our society. It is a wonderful application to manage guest entries and approvals. I strongly recommend for your society. You can download it from https://maplink.com',
        ...(includeQr ? { qrCodeImageUrl: user.qrCodeImage || null } : {}),
    };
};

const getVisitorProfile = async (req, res, next) => {
    try {
        const user = req.appUser;
        if (!user) {
            return next(createHttpError('Unauthorized', 401));
        }

        if (user.role !== 'visitor') {
            return next(createHttpError('Only visitors can access this profile', 403));
        }

        const qrCodeImageUrl = await ensureVisitorQrCode(user);
        const companyLogo = await resolveCompanyLogo(user.visitorType, user.visitorCompanyName);
        user.qrCodeImage = qrCodeImageUrl;

        return sendSuccessResponse(res, 200, 'Visitor profile fetched successfully', {
            data: buildVisitorProfileResponse(user, { includeQr: true, companyLogo }),
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch visitor profile'));
    }
};

const updateVisitorProfile = async (req, res, next) => {
    try {
        const user = req.appUser;
        if (!user) {
            return next(createHttpError('Unauthorized', 401));
        }

        if (user.role !== 'visitor') {
            return next(createHttpError('Only visitors can update this profile', 403));
        }

        const payload = req.body || {};

        // Allowed fields:
        // image, fullName, phoneNumber, vehicleNumber, companyName, subCategory
        const imageRaw = payload.image !== undefined ? payload.image : (payload.imageUrl !== undefined ? payload.imageUrl : payload.profilePhoto);
        const fullNameRaw = payload.fullName;
        const phoneNumberRaw = payload.phoneNumber;
        const vehicleNumberRaw = payload.vehicleNumber;
        const companyNameRaw = payload.companyName;
        const subCategoryRaw = payload.subCategory;

        const updates = {};
        let shouldInvalidateQr = false;

        if (imageRaw !== undefined) {
            const trimmed = normalizeString(imageRaw);
            if (!trimmed) {
                updates.profilePhoto = null;
            } else {
                try {
                    updates.profilePhoto = ensureBase64ImageDataUrl({ value: trimmed, fieldLabel: 'Image' });
                } catch (e) {
                    return next(createHttpError(e.message, 400));
                }
            }
        }

        if (fullNameRaw !== undefined) {
            const candidateName = toTitleCaseName(fullNameRaw);
            if (!candidateName) {
                return next(createHttpError('fullName cannot be empty', 400));
            }
            updates.fullName = candidateName;
            shouldInvalidateQr = true;
        }

        if (phoneNumberRaw !== undefined) {
            const digits = String(phoneNumberRaw).replace(/\D/g, '');
            if (!digits || digits.length !== 10) {
                return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
            }

            const alreadyUser = await User.exists({ phoneNumber: digits, _id: { $ne: user._id } });
            if (alreadyUser) {
                return next(createHttpError('This phone number already exists in the system', 409));
            }

            const saExists = await SuperAdmin.exists({ phoneNumber: digits });
            if (saExists) {
                return next(createHttpError('This phone number already exists in the system', 409));
            }

            const adminMatch = await lookupSocietyAdminByMobile(digits);
            if (adminMatch) {
                const linkedId = user.linkedSocietyAdminId || null;
                if (!linkedId || String(linkedId) !== String(adminMatch.adminId)) {
                    return next(createHttpError('This phone number already exists in the system', 409));
                }
            }

            updates.phoneNumber = digits;
            shouldInvalidateQr = true;
        }

        if (vehicleNumberRaw !== undefined) {
            const candidate = normalizeString(vehicleNumberRaw).toUpperCase();
            if (!candidate) {
                updates.visitorVehicleNumber = null;
            } else {
                if (!/^[A-Z0-9]{4,15}$/.test(candidate)) {
                    return next(
                        createHttpError(
                            'vehicleNumber must be alphanumeric without spaces or special characters',
                            400
                        )
                    );
                }
                updates.visitorVehicleNumber = candidate;
            }
        }

        if (companyNameRaw !== undefined) {
            const candidate = normalizeString(companyNameRaw);
            if (!candidate) {
                updates.visitorCompanyName = null;
            } else {
                if (candidate.length < 2 || candidate.length > 80) {
                    return next(createHttpError('companyName must be between 2 and 80 characters', 400));
                }
                updates.visitorCompanyName = candidate;
            }
        }

        if (subCategoryRaw !== undefined) {
            const candidate = normalizeString(subCategoryRaw);
            if (!candidate) {
                updates.visitorWorkCategory = null;
            } else {
                if (candidate.length < 3 || candidate.length > 60) {
                    return next(createHttpError('subCategory must be between 3 and 60 characters', 400));
                }
                updates.visitorWorkCategory = candidate;
            }
        }

        if (Object.keys(updates).length === 0) {
            return sendSuccessResponse(res, 200, 'No changes provided');
        }

        Object.assign(user, updates);

        // Keep onboardingData in sync (best-effort, non-breaking)
        if (user.onboardingData) {
            user.onboardingData = {
                ...(user.onboardingData || {}),
                visitor: {
                    ...(user.onboardingData?.visitor || {}),
                    ...(updates.fullName !== undefined ? { fullName: user.fullName } : {}),
                    ...(updates.profilePhoto !== undefined
                        ? {
                            hasProfilePhoto: Boolean(user.profilePhoto),
                            profilePhotoCapturedAt: user.profilePhoto ? (user.profilePhotoCapturedAt || new Date()) : null,
                        }
                        : {}),
                },
            };
        }

        if (shouldInvalidateQr) {
            user.qrCodeImage = null;
            user.qrCodeGeneratedAt = null;
        }

        await user.save();

        // Return same payload as getProfile, including fresh QR if invalidated.
        const qrCodeImageUrl = await ensureVisitorQrCode(user);
        const companyLogo = await resolveCompanyLogo(user.visitorType, user.visitorCompanyName);
        user.qrCodeImage = qrCodeImageUrl;

        return sendSuccessResponse(res, 200, 'Visitor profile updated successfully', {
            data: buildVisitorProfileResponse(user, { includeQr: true, companyLogo }),
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to update visitor profile'));
    }
};

module.exports = {
    getVisitorProfile,
    updateVisitorProfile,
};


