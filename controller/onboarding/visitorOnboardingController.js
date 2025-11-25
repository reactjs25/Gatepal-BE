const { createHttpError } = require('../../utils/httpError');

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

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp']);

const ensureBase64ImageDataUrl = ({ value, fieldLabel, minBytes = 1024 }) => {
  const trimmed = (value || '').trim();

  if (!trimmed) {
    throw createHttpError(`${fieldLabel} is required to continue onboarding`, 400);
  }

  const dataUrlMatch = trimmed.match(/^data:image\/([a-z+]+);base64,/i);

  if (!dataUrlMatch) {
    throw createHttpError(`${fieldLabel} must be a base64 encoded image data URL`, 400);
  }

  const mimeType = dataUrlMatch[1]?.toLowerCase();

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw createHttpError(`${fieldLabel} must be PNG, JPG, JPEG, or WEBP`, 400);
  }

  const payload = trimmed.substring(trimmed.indexOf(',') + 1).replace(/\s+/g, '');

  if (!payload) {
    throw createHttpError(`${fieldLabel} payload is empty`, 400);
  }

  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64');
  } catch (error) {
    throw createHttpError(`${fieldLabel} payload is not valid base64 data`, 400);
  }

  if (!decoded || decoded.length < minBytes) {
    throw createHttpError(`${fieldLabel} appears invalid or too small`, 400);
  }

  return trimmed;
};

const handleVisitorOnboarding = async ({ user, payload }) => {
  const {
    visitorType,
    fullName,
    profilePhoto,
    qrCodeImage,
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

  const sanitizedFullName = fullName?.trim();

  if (!sanitizedFullName) {
    throw createHttpError('Full name is required for visitor onboarding', 400);
  }

  const sanitizedPhoto = ensureBase64ImageDataUrl({
    value: profilePhoto,
    fieldLabel: 'Visitor photo',
  });

  const sanitizedQrCodeImage = ensureBase64ImageDataUrl({
    value: qrCodeImage,
    fieldLabel: 'Visitor QR code',
    minBytes: 512,
  });

  user.fullName = sanitizedFullName;
  user.visitorType = normalizedVisitorType;
  user.profilePhoto = sanitizedPhoto;
  user.profilePhotoCapturedAt = new Date();
  user.qrCodeImage = sanitizedQrCodeImage;
  user.qrCodeGeneratedAt = new Date();
  const onboardingData = {
    ...(user.onboardingData || {}),
    visitor: {
      ...(user.onboardingData?.visitor || {}),
      visitorType: user.visitorType,
      fullName: user.fullName,
      profilePhotoCapturedAt: user.profilePhotoCapturedAt,
      hasProfilePhoto: true,
      qrCodeGeneratedAt: user.qrCodeGeneratedAt,
      hasQrCodeImage: true,
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


