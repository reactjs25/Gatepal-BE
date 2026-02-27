const mongoose = require('mongoose');
const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');
const { normalizeImageInputToStorageUrl } = require('../../utils/imageDataUrl');
const { toTitleCaseName } = require('../../utils/strings');

const ensureBase64ImageDataUrlGuard = async ({ value, fieldLabel, keyPrefix, fileName }) => {
  try {
    return await normalizeImageInputToStorageUrl({ value, fieldLabel, keyPrefix, fileName });
  } catch (e) {
    throw createHttpError(e.message, 400);
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

const handleGuardOnboarding = async ({ user, payload }) => {
  const fullName = getLastBodyValue(payload.fullName);
  const profilePhoto = getLastBodyValue(payload.profilePhoto);
  const societyName = getLastBodyValue(payload.societyName);
  const societyPin = getLastBodyValue(payload.societyPin);

  const sanitizedFullName = toTitleCaseName(fullName);
  if (!sanitizedFullName) {
    throw createHttpError('Full name is required for guard onboarding.', 400);
  }

  let sanitizedPhoto = null;
  if (profilePhoto !== undefined) {
    const hasProfilePhoto = Boolean((profilePhoto || '').trim());
    if (hasProfilePhoto) {
      sanitizedPhoto = await ensureBase64ImageDataUrlGuard({
        value: profilePhoto,
        fieldLabel: 'Guard photo',
        keyPrefix: `guards/${String(user._id)}/profile`,
        fileName: `profile-${Date.now()}`,
      });
    }
  }

  const normalizedSocietyName = (societyName || '').toString().trim();
  const normalizedSocietyPin = (societyPin || '').toString().trim();

  let society = null;
  if (normalizedSocietyName && normalizedSocietyPin) {
    const nameRegex = new RegExp(`^${escapeRegex(normalizedSocietyName)}$`, 'i');
    society = await Society.findOne({ societyName: nameRegex, societyPin: normalizedSocietyPin });
    if (!society) {
      throw createHttpError('Society not found for provided name and PIN.', 404);
    }
  }

  user.fullName = sanitizedFullName;
  if (sanitizedPhoto) {
    user.profilePhoto = sanitizedPhoto;
    user.profilePhotoCapturedAt = new Date();
  }
  user.societyId = society ? society._id : null;
  user.societyName = society ? society.societyName : null;

 
  if (society) {
    if (!Array.isArray(user.guardSocieties)) {
      user.guardSocieties = [];
    }
    const alreadyExists = user.guardSocieties.some(
      (s) => String(s.societyId) === String(society._id)
    );
    if (!alreadyExists) {
      user.guardSocieties.push({
        societyId: society._id,
        societyName: society.societyName,
        addedAt: new Date(),
      });
    }
  }

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

