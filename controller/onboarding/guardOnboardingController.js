const mongoose = require('mongoose');
const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');

const assertObjectId = (value, message) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(message, 400);
  }
};

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
  const SUPPORTED_IMAGE_MIME_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp']);

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

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const handleGuardOnboarding = async ({ user, payload }) => {
  const { fullName, profilePhoto, societyName, societyPin } = payload;

  const sanitizedFullName = fullName?.trim();
  if (!sanitizedFullName) {
    throw createHttpError('Full name is required for guard onboarding', 400);
  }

  let sanitizedPhoto = null;
  if (profilePhoto !== undefined) {
    const hasProfilePhoto = Boolean((profilePhoto || '').trim());
    if (hasProfilePhoto) {
      sanitizedPhoto = ensureBase64ImageDataUrl({ value: profilePhoto, fieldLabel: 'Guard photo' });
    }
  }

  const normalizedSocietyName = (societyName || '').toString().trim();
  const normalizedSocietyPin = (societyPin || '').toString().trim();

  let society = null;
  if (normalizedSocietyName && normalizedSocietyPin) {
    const nameRegex = new RegExp(`^${escapeRegex(normalizedSocietyName)}$`, 'i');
    society = await Society.findOne({ societyName: nameRegex, societyPin: normalizedSocietyPin });
    if (!society) {
      throw createHttpError('Society not found for provided name and PIN', 404);
    }
  }

  user.fullName = sanitizedFullName;
  if (sanitizedPhoto) {
    user.profilePhoto = sanitizedPhoto;
    user.profilePhotoCapturedAt = new Date();
  }
  user.societyId = society ? society._id : null;
  user.societyName = society ? society.societyName : null;
  user.onboardingData = {
    ...(user.onboardingData || {}),
    guard: {
      fullName: user.fullName,
      hasProfilePhoto: Boolean(user.profilePhoto),
      profilePhotoCapturedAt: user.profilePhotoCapturedAt || null,
      societyId: society ? society._id : null,
      societyName: society ? society.societyName : null,
      societyPin: normalizedSocietyPin || null,
    },
  };

  return { society };
};

module.exports = {
  handleGuardOnboarding,
};

