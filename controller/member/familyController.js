const mongoose = require('mongoose');
const FamilyMember = require('../../model/familyMemberSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { normalizeDigits, normalizeCountryCode } = require('../../utils/phoneNumber');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { sendSuccessResponse } = require('../../utils/response');

const ALLOWED_CATEGORIES = new Set(['adult', 'child']);
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp']);

const normalizeString = (v) => (v || '').toString().trim();

const ensureBase64ImageDataUrl = ({ value, fieldLabel, minBytes = 512 }) => {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  const match = trimmed.match(/^data:image\/([a-z+]+);base64,/i);
  if (!match) throw createHttpError(`${fieldLabel} must be a base64 encoded image data URL`, 400);
  const mime = match[1]?.toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    throw createHttpError(`${fieldLabel} must be PNG, JPG, JPEG, or WEBP`, 400);
  }
  const payload = trimmed.substring(trimmed.indexOf(',') + 1).replace(/\s+/g, '');
  let buf;
  try {
    buf = Buffer.from(payload, 'base64');
  } catch (e) {
    throw createHttpError(`${fieldLabel} payload is not valid base64 data`, 400);
  }
  if (!buf || buf.length < minBytes) {
    throw createHttpError(`${fieldLabel} appears invalid or too small`, 400);
  }
  return trimmed;
};

const validateAddFamilyInput = (input = {}) => {
  const unitId = normalizeString(input.unitId);
  const category = normalizeString(input.category).toLowerCase();
  const name = normalizeString(input.name);
  const countryCode = normalizeCountryCode(input.countryCode);
  const phoneDigits = normalizeDigits(input.phoneNumber || '');
  const imageUrl = input.image !== undefined ? ensureBase64ImageDataUrl({ value: input.image, fieldLabel: 'Image' }) : null;

  if (!unitId) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(unitId)) throw createHttpError('Invalid unit ID format', 400);
  if (!category || !ALLOWED_CATEGORIES.has(category)) throw createHttpError('category must be one of adult, child', 400);
  if (!name) throw createHttpError('name is required', 400);
  if (category === 'adult') {
    if (!phoneDigits || phoneDigits.length < 10) {
      throw createHttpError('phoneNumber is required for adult and must contain at least 10 digits', 400);
    }
  }

  return { unitId, category, name, countryCode, phoneDigits, imageUrl, rawPhone: input.phoneNumber };
};

const addFamilyMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    let validated;
    try {
      const unitIdCandidate = normalizeString(
        (req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId
      );
      validated = validateAddFamilyInput({ ...(req.body || {}), unitId: unitIdCandidate });
    } catch (e) {
      return next(e);
    }

    const unitDoc = await MemberUnit.findById(validated.unitId);
    if (!unitDoc) return next(createHttpError('Unit not found', 404));
    if (String(unitDoc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit', 403));
    }

    const comparablePhone = validated.phoneDigits
      ? `${normalizeCountryCode(validated.countryCode).replace(/\D/g, '')}${validated.phoneDigits}`
      : null;

    if (comparablePhone) {
      const duplicate = await FamilyMember.exists({ unitId: unitDoc._id, comparablePhone });
      if (duplicate) return next(createHttpError('A family member with this phone already exists in this unit', 409));
    }

    const payload = {
      unitId: unitDoc._id,
      createdByUserId: authUser._id,
      category: validated.category,
      name: validated.name,
      countryCode: validated.countryCode,
      phoneNumber: validated.phoneDigits ? validated.rawPhone : null,
      phoneDigits: validated.phoneDigits || null,
      comparablePhone: comparablePhone || null,
      imageUrl: validated.imageUrl,
      status: 'Inactive on GatePal',
    };

    let doc = await FamilyMember.create(payload);

    if (validated.phoneDigits) {
      const matchedUser = await User.findOne({ phoneNumber: validated.phoneDigits });
      if (matchedUser) {
        doc.status = 'Active on GatePal';
        doc.linkedUserId = matchedUser._id;
        await doc.save();
      }
    }

    return sendSuccessResponse(res, 201, 'Family member added successfully', {
      data: {
        id: String(doc._id),
        unitId: String(doc.unitId),
        category: doc.category,
        name: doc.name,
        countryCode: doc.countryCode,
        phoneNumber: doc.phoneNumber,
        imageUrl: doc.imageUrl,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add family member'));
  }
};

const getFamilyMembersByUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

    const unitId = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    if (!unitId) return next(createHttpError('unitId path parameter is required', 400));
    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit ID format', 400));
    }

    const unitDoc = await MemberUnit.findById(unitId);
    if (!unitDoc) return next(createHttpError('Unit not found', 404));
    if (String(unitDoc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit', 403));
    }

    const members = await FamilyMember.find({ unitId: unitDoc._id })
      .sort({ createdAt: -1 })
      .lean();

    const data = members.map((m) => ({
      id: String(m._id),
      unitId: String(m.unitId),
      category: m.category,
      name: m.name,
      countryCode: m.countryCode,
      phoneNumber: m.phoneNumber,
      imageUrl: m.imageUrl,
      status: m.status,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    return sendSuccessResponse(res, 200, 'Family members fetched successfully', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch family members'));
  }
};

module.exports = {
  addFamilyMember,
  validateAddFamilyInput,
  getFamilyMembersByUnit,
};
