const { createHttpError } = require('../../utils/httpError');
const { ensureBase64ImageDataUrl } = require('../../utils/imageDataUrl');
const QRCode = require('qrcode');
const { toTitleCaseName } = require('../../utils/strings');
const { getTaxiCompanyDisplayName } = require('../../utils/taxiDriverCompanies');

const VISITOR_TYPES = {
  GUEST: 'guest',
  DELIVERY_EXECUTIVE: 'delivery_executive',
  TAXI_VEHICLE_DRIVER: 'taxi_vehicle_driver',
  OTHER_VISITOR: 'other_visitor',
};

const SUPPORTED_VISITOR_TYPES = new Set(Object.values(VISITOR_TYPES));
const VEHICLE_REQUIRED_VISITOR_TYPES = new Set([
  VISITOR_TYPES.DELIVERY_EXECUTIVE,
  VISITOR_TYPES.TAXI_VEHICLE_DRIVER,
  VISITOR_TYPES.OTHER_VISITOR,
]);

const ensureImage = ({ value, fieldLabel }) => {
  try {
    return ensureBase64ImageDataUrl({ value, fieldLabel });
  } catch (e) {
    throw createHttpError(e.message, 400);
  }
};

const buildVisitorQrPayload = (user) =>
  JSON.stringify({
    type: 'gatepal_visitor',
    version: 2,
    userId: String(user._id),
    role: user.role,
    visitorType: user.visitorType || null,
    fullName: user.fullName || null,
    phoneNumber: user.phoneNumber || null,
    vehicleNumber: user.visitorVehicleNumber || null,
  });

const handleVisitorOnboarding = async ({ user, payload }) => {
  const {
    visitorType,
    fullName,
    profilePhoto,
    companyName,
    vehicleNumber,
    workCategory,
  } = payload;

  const normalizedVisitorType = (visitorType || '').toString().trim().toLowerCase();

  if (!normalizedVisitorType) {
    throw createHttpError('Visitor type is required for onboarding', 400);
  }

  if (!SUPPORTED_VISITOR_TYPES.has(normalizedVisitorType)) {
    throw createHttpError('Unsupported visitor type provided', 400);
  }

  const sanitizedFullName = toTitleCaseName(fullName);

  if (!sanitizedFullName) {
    throw createHttpError('Full name is required for visitor onboarding', 400);
  }

  const hasProfilePhoto = Boolean((profilePhoto || '').trim());

  let sanitizedPhoto = null;

  if (hasProfilePhoto) {
    sanitizedPhoto = ensureImage({
      value: profilePhoto,
      fieldLabel: 'Visitor photo',
    });
  }

  user.fullName = sanitizedFullName;
  user.visitorType = normalizedVisitorType;
  if (sanitizedPhoto) {
    user.profilePhoto = sanitizedPhoto;
    user.profilePhotoCapturedAt = new Date();
  }

  
  if (!user.qrCodeImage) {
    try {
      const qrPayload = buildVisitorQrPayload(user);
      const qrCodeImage = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      });
      user.qrCodeImage = qrCodeImage;
      user.qrCodeGeneratedAt = new Date();
    } catch (e) {
      
      user.qrCodeImage = user.qrCodeImage || null;
      user.qrCodeGeneratedAt = user.qrCodeGeneratedAt || null;
    }
  }
  const onboardingData = {
    ...(user.onboardingData || {}),
    visitor: {
      ...(user.onboardingData?.visitor || {}),
      visitorType: user.visitorType,
      fullName: user.fullName,
      profilePhotoCapturedAt: user.profilePhotoCapturedAt,
      hasProfilePhoto: Boolean(user.profilePhoto),
      qrCodeGeneratedAt: user.qrCodeGeneratedAt,
      hasQrCodeImage: Boolean(user.qrCodeImage),
    },
  };

  let sanitizedCompanyName = null;
  let sanitizedVehicleNumber = null;

  if (VEHICLE_REQUIRED_VISITOR_TYPES.has(normalizedVisitorType)) {
    sanitizedCompanyName = companyName?.trim();
    sanitizedVehicleNumber = vehicleNumber?.toString().trim().toUpperCase();

    if (!sanitizedCompanyName) {
      throw createHttpError('Company name is required for this visitor type', 400);
    }

    if (!sanitizedVehicleNumber) {
      throw createHttpError('Vehicle number is required for this visitor type', 400);
    }

    if (!/^[A-Z0-9]{4,15}$/.test(sanitizedVehicleNumber)) {
      throw createHttpError(
        'Vehicle number must be alphanumeric without spaces or special characters',
        400
      );
    }

    if (normalizedVisitorType === VISITOR_TYPES.TAXI_VEHICLE_DRIVER) {
      const matchedTaxiCompany = getTaxiCompanyDisplayName(sanitizedCompanyName);
      if (!matchedTaxiCompany) {
        throw createHttpError(
          'Taxi company must be one of: Ola, Uber, Meru, Rapido',
          400
        );
      }
      sanitizedCompanyName = matchedTaxiCompany;
    }
  }

  let sanitizedWorkCategory = null;

  if (normalizedVisitorType === VISITOR_TYPES.OTHER_VISITOR) {
    sanitizedWorkCategory = workCategory?.trim();

    if (!sanitizedWorkCategory) {
      throw createHttpError('Work category is required for other visitors', 400);
    }

    if (sanitizedWorkCategory.length < 3 || sanitizedWorkCategory.length > 60) {
      throw createHttpError('Work category must be between 3 and 60 characters', 400);
    }
  }

  user.visitorCompanyName = sanitizedCompanyName;
  user.visitorVehicleNumber = sanitizedVehicleNumber;
  user.visitorWorkCategory = sanitizedWorkCategory;

  if (
    normalizedVisitorType !== VISITOR_TYPES.GUEST &&
    !VEHICLE_REQUIRED_VISITOR_TYPES.has(normalizedVisitorType)
  ) {
    throw createHttpError('Onboarding for this visitor type is not yet supported', 400);
  }

  if (VEHICLE_REQUIRED_VISITOR_TYPES.has(normalizedVisitorType)) {
    const vehicleDetailsKey =
      normalizedVisitorType === VISITOR_TYPES.DELIVERY_EXECUTIVE
        ? 'deliveryExecutive'
        : normalizedVisitorType === VISITOR_TYPES.TAXI_VEHICLE_DRIVER
        ? 'taxiVehicleDriver'
        : 'otherVisitor';

    onboardingData.visitor[vehicleDetailsKey] = {
      companyName: user.visitorCompanyName,
      vehicleNumber: user.visitorVehicleNumber,
      ...(user.visitorWorkCategory ? { workCategory: user.visitorWorkCategory } : {}),
    };
  }

  if (
    normalizedVisitorType === VISITOR_TYPES.OTHER_VISITOR &&
    !onboardingData.visitor.otherVisitor
  ) {
    onboardingData.visitor.otherVisitor = {
      companyName: user.visitorCompanyName,
      vehicleNumber: user.visitorVehicleNumber,
      workCategory: user.visitorWorkCategory,
    };
  }

  user.onboardingData = onboardingData;

  return { society: null };
};


module.exports = {
  handleVisitorOnboarding,
  VISITOR_TYPES,
};


