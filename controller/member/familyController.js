const mongoose = require('mongoose');
const FamilyMember = require('../../model/familyMemberSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { normalizeDigits, normalizeCountryCode, getComparablePhoneNumber } = require('../../utils/phoneNumber');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { sendSuccessResponse } = require('../../utils/response');
const { normalizeImageInputToStorageUrl } = require('../../utils/imageDataUrl');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');

const ALLOWED_CATEGORIES = new Set(['adult', 'child']);
const FAMILY_LIST_CACHE_TTL_MS = 20000;
const familyListCache = new Map();
const FAMILY_CACHE_SCOPES = ['', 'self', 'others', 'all'];

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

const invalidateFamilyCacheForUnits = async ({ authUserId, unitDocs }) => {
  if (!authUserId || !Array.isArray(unitDocs) || unitDocs.length === 0) return;

  const groupedUnitIds = new Set();
  const uniqueGroups = new Set();

  for (const unitDoc of unitDocs) {
    if (!unitDoc || !unitDoc.societyId || !unitDoc.wingNameLower || !unitDoc.unitNumberLower) continue;
    uniqueGroups.add(`${String(unitDoc.societyId)}|${unitDoc.wingNameLower}|${unitDoc.unitNumberLower}`);
  }

  for (const key of uniqueGroups) {
    const [societyId, wingNameLower, unitNumberLower] = key.split('|');
    const peers = await MemberUnit.find({ societyId, wingNameLower, unitNumberLower }).select('_id').lean();
    for (const peer of peers) {
      groupedUnitIds.add(String(peer._id));
    }
  }

  for (const unitId of groupedUnitIds) {
    for (const scope of FAMILY_CACHE_SCOPES) {
      familyListCache.delete(`${String(authUserId)}:${unitId}:${scope}`);
    }
  }
};

const getFamilyDisplayStatus = ({ category, status }) => {
  return category === 'child' ? 'No access for child' : status;
};

const ensureImageMaybe = ({ value, fieldLabel, minBytes = 512 }) => {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  return trimmed;
};

const validateAddFamilyInput = (input = {}) => {
  const unitId = normalizeString(getLastBodyValue(input.unitId));
  const category = normalizeString(getLastBodyValue(input.category)).toLowerCase();
  const name = toTitleCaseName(getLastBodyValue(input.name));
  const countryCode = normalizeCountryCode(getLastBodyValue(input.countryCode));
  const rawPhone = getLastBodyValue(input.phoneNumber);
  const phoneDigits = normalizeDigits(rawPhone || '');
  const incomingImageSource = input.imageUrl !== undefined ? input.imageUrl : input.image;
  const incomingImage = getLastBodyValue(incomingImageSource);
  const imageInput = incomingImage !== undefined ? ensureImageMaybe({ value: incomingImage, fieldLabel: 'Image' }) : null;

  if (!unitId) throw createHttpError('unitId path parameter is required.', 400);
  if (!mongoose.Types.ObjectId.isValid(unitId)) throw createHttpError('Invalid unit ID format.', 400);
  if (!category || !ALLOWED_CATEGORIES.has(category)) throw createHttpError('category must be one of adult, child.', 400);
  if (!name) throw createHttpError('name is required.', 400);
  if (category === 'adult') {
    if (!phoneDigits) {
      throw createHttpError('phoneNumber is required for adult.', 400);
    }
  }

  if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 12)) {
    throw createHttpError('Please enter a valid phone number.', 400);
  }

  return { unitId, category, name, countryCode, phoneDigits, imageInput, rawPhone };
};

const addFamilyMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
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
    if (!unitDoc) return next(createHttpError('Unit not found.', 404));
    if (String(unitDoc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit.', 403));
    }

    const comparablePhone = validated.phoneDigits
      ? `${normalizeCountryCode(validated.countryCode).replace(/\D/g, '')}${validated.phoneDigits}`
      : null;

    if (validated.phoneDigits) {
      const existsUser = await User.exists({ phoneNumber: validated.phoneDigits });
      if (existsUser) return next(createHttpError('This phone number already exists in the system.', 409));
    }

    if (comparablePhone) {
      const duplicate = await FamilyMember.exists({ comparablePhone });
      if (duplicate) return next(createHttpError('This phone number already exists in the system.', 409));
    }

    let resolvedImageUrl = null;
    if (validated.imageInput) {
      try {
        resolvedImageUrl = await normalizeImageInputToStorageUrl({
          value: validated.imageInput,
          fieldLabel: 'Image',
          keyPrefix: `family/${String(unitDoc._id)}/members`,
          fileName: `member-${Date.now()}`,
        });
      } catch (e) {
        return next(createHttpError(e.message, 400));
      }
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
      imageUrl: resolvedImageUrl,
      status: 'Inactive on GatePal™',
    };

    let doc = await FamilyMember.create(payload);

    if (validated.phoneDigits && validated.category !== 'child') {
      const matchedUser = await User.findOne({ phoneNumber: validated.phoneDigits });
      if (matchedUser) {
        doc.status = 'Active on GatePal™';
        doc.linkedUserId = matchedUser._id;
        await doc.save();
      }
    }

    return sendSuccessResponse(res, 201, 'Family member details saved successfully.', {
      data: {
        id: String(doc._id),
        unitId: String(doc.unitId),
        category: doc.category,
        name: doc.name,
        countryCode: doc.countryCode,
        phoneNumber: doc.phoneNumber,
        imageUrl: doc.imageUrl,
        status: getFamilyDisplayStatus({ category: doc.category, status: doc.status }),
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
    if (!authUser) return next(createHttpError('Unauthorized.', 401));

    const unitId = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    if (!unitId) return next(createHttpError('unitId path parameter is required.', 400));
    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit ID format.', 400));
    }

    const unitDoc = await MemberUnit.findById(unitId);
    if (!unitDoc) return next(createHttpError('Unit not found.', 404));
    if (String(unitDoc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit.', 403));
    }

    const cacheKey = `${String(authUser._id)}:${String(unitDoc._id)}:${String((req.query && req.query.scope) || '')}`;
    const cached = familyListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return sendSuccessResponse(res, 200, 'Family members fetched successfully.', { data: cached.data });
    }

    const peers = await MemberUnit.find({
      societyId: unitDoc.societyId,
      wingNameLower: unitDoc.wingNameLower,
      unitNumberLower: unitDoc.unitNumberLower,
    }).lean();

    const scope = normalizeString((req.query && req.query.scope) || '');

    let targetUnitIds = peers.map((p) => p._id);
    if (scope === 'self') {
      targetUnitIds = [unitDoc._id];
    } else if (scope === 'others') {
      targetUnitIds = targetUnitIds.filter((id) => String(id) !== String(unitDoc._id));
    } else {
      targetUnitIds = targetUnitIds;
    }

    const members = await FamilyMember.find({ unitId: { $in: targetUnitIds } })
      .sort({ createdAt: -1 })
      .lean();

    const unitTypeMap = peers.reduce((acc, p) => {
      const famType = p.occupantType === 'unit_owner'
        ? 'unit_owner_family_member'
        : p.occupantType === 'tenant'
          ? 'tenant_family_member'
          : p.occupantType;
      acc[String(p._id)] = famType;
      return acc;
    }, {});

    const primaryPeers = peers.filter(
      (p) =>
        p &&
        (
          p.occupantType === 'unit_owner' ||
          p.occupantType === 'tenant' ||
          p.occupantType === 'unit_owner_family_member' ||
          p.occupantType === 'tenant_family_member'
        )
    );
    let occupantPeers;
    if (scope === 'self') {
      occupantPeers = primaryPeers.filter((p) => String(p.memberId) === String(authUser._id));
    } else if (scope === 'all') {
      occupantPeers = primaryPeers;
    } else {
      occupantPeers = primaryPeers.filter((p) => String(p.memberId) !== String(authUser._id));
    }

    const occupantItems = [];
    for (const p of occupantPeers) {
      const u = await User.findById(p.memberId).lean();
      if (!u) continue;
      occupantItems.push({
        id: String(u._id),
        unitId: String(p._id),
        category: 'adult',
        name: u.fullName || null,
        countryCode: u.countryCode || '+91',
        phoneNumber: u.phoneNumber || null,
        imageUrl: u.profilePhoto || null,
        occupantType: p.occupantType,
        status: 'Active on GatePal™',
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      });
    }

    const occupantPhones = new Set(
      occupantItems
        .map((item) => normalizeDigits(item.phoneNumber || ''))
        .filter((digits) => digits && digits.length >= 10 && digits.length <= 12)
    );

    const data = members
      .filter((m) => {
        const digits = normalizeDigits(m.phoneDigits || m.phoneNumber || '');
        return !digits || !occupantPhones.has(digits);
      })
      .map((m) => ({
        id: String(m._id),
        unitId: String(m.unitId),
        category: m.category,
        name: m.name,
        countryCode: m.countryCode,
        phoneNumber: m.phoneNumber,
        imageUrl: m.imageUrl,
        occupantType: unitTypeMap[String(m.unitId)] || null,
        status: getFamilyDisplayStatus({ category: m.category, status: m.status }),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }))
      .concat(occupantItems);

    const authPhone = normalizeDigits(authUser.phoneNumber || '');
    const filtered = data.filter((item) => normalizeDigits(item.phoneNumber || '') !== authPhone && String(item.id) !== String(authUser._id));

    familyListCache.set(cacheKey, { data: filtered, expiresAt: Date.now() + FAMILY_LIST_CACHE_TTL_MS });
    return sendSuccessResponse(res, 200, 'Family members fetched successfully.', { data: filtered });

  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch family members'));
  }
};

const updateFamilyMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));

    const memberId = normalizeString((req.params && req.params.memberId) || '');
    if (!memberId) return next(createHttpError('memberId path parameter is required.', 400));
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return next(createHttpError('Invalid member ID format.', 400));
    }

    let doc = await FamilyMember.findById(memberId);
    if (!doc) {
      const targetUser = await User.findById(memberId);
      if (!targetUser) return next(createHttpError('Family member not found.', 404));

      const authUnits = await MemberUnit.find({ memberId: authUser._id }).lean();
      const userUnits = await MemberUnit.find({ memberId: targetUser._id }).lean();

      const matchingUnit = userUnits.find((uu) =>
        authUnits.some(
          (au) =>
            String(au.societyId) === String(uu.societyId) &&
            au.wingNameLower === uu.wingNameLower &&
            au.unitNumberLower === uu.unitNumberLower
        )
      );

      if (!matchingUnit) return next(createHttpError('Forbidden: you do not own this unit.', 403));

      const payload = req.body || {};
      const imageRaw =
        payload.image !== undefined
          ? payload.image
          : payload.imageUrl !== undefined
            ? payload.imageUrl
            : payload.profilePhoto !== undefined
              ? payload.profilePhoto
              : payload.profileImage;
      const phoneRaw = getLastBodyValue(
        payload.phoneNumber !== undefined ? payload.phoneNumber : payload.phone
      );
      const name = getLastBodyValue(payload.name);
      const countryCode = getLastBodyValue(payload.countryCode);

      const updates = {};

      if (countryCode !== undefined) {
        updates.countryCode = normalizeCountryCode(countryCode);
      }

      if (name !== undefined) {
        const nm = toTitleCaseName(name);
        if (!nm) return next(createHttpError('name cannot be empty.', 400));
        updates.fullName = nm;
      }

      if (imageRaw !== undefined) {
        const trimmed = normalizeString(getLastBodyValue(imageRaw));
        if (!trimmed) {
          updates.profilePhoto = null;
          updates.profilePhotoCapturedAt = null;
        } else {
          try {
            updates.profilePhoto = await normalizeImageInputToStorageUrl({
              value: trimmed,
              fieldLabel: 'Image',
              keyPrefix: `users/${String(targetUser._id)}/profile`,
              fileName: `profile-${Date.now()}`,
            });
            updates.profilePhotoCapturedAt = new Date();
          } catch (e) {
            return next(createHttpError(e.message, 400));
          }
        }
      }

      if (phoneRaw !== undefined) {
        const digits = normalizeDigits(phoneRaw || '');
        if (digits && (digits.length < 10 || digits.length > 12)) {
          return next(createHttpError('Please enter a valid phone number.', 400));
        }

        if (!digits) {
          return next(createHttpError('phoneNumber is required for adult.', 400));
        }

        const SuperAdmin = require('../../model/superAdminSchema');
        const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

        const existingUser = await User.exists({ phoneNumber: digits, _id: { $ne: targetUser._id } });
        if (existingUser) return next(createHttpError('This phone number already exists in the system.', 409));

        const fmExists = await FamilyMember.exists({ phoneDigits: digits });
        if (fmExists) return next(createHttpError('This phone number already exists in the system.', 409));

        const saExists = await SuperAdmin.exists({ phoneNumber: digits });
        if (saExists) return next(createHttpError('This phone number already exists in the system.', 409));

        const adminExists = await lookupSocietyAdminByMobile(digits);
        if (adminExists) return next(createHttpError('This phone number already exists in the system.', 409));

        updates.phoneNumber = digits;
      }

      if (Object.keys(updates).length === 0) {
        return sendSuccessResponse(res, 200, 'No changes provided.', {
          data: {
            id: String(targetUser._id),
            unitId: String(matchingUnit._id),
            category: 'adult',
            name: targetUser.fullName || null,
            countryCode: targetUser.countryCode || '+91',
            phoneNumber: targetUser.phoneNumber || null,
            imageUrl: targetUser.profilePhoto || null,
            status: 'Active on GatePal™',
            createdAt: targetUser.createdAt,
            updatedAt: targetUser.updatedAt,
          },
        });
      }

      Object.assign(targetUser, updates);
      await targetUser.save();

      return sendSuccessResponse(res, 200, 'Family member details update successfully.', {
        data: {
          id: String(targetUser._id),
          unitId: String(matchingUnit._id),
          category: 'adult',
          name: targetUser.fullName || null,
          countryCode: targetUser.countryCode || '+91',
          phoneNumber: targetUser.phoneNumber || null,
          imageUrl: targetUser.profilePhoto || null,
          status: 'Active on GatePal™',
          createdAt: targetUser.createdAt,
          updatedAt: targetUser.updatedAt,
        },
      });
    }

    const unitDoc = await MemberUnit.findById(doc.unitId);
    if (!unitDoc) return next(createHttpError('Unit not found.', 404));
    const hasAccess = await MemberUnit.exists({
      societyId: unitDoc.societyId,
      wingNameLower: unitDoc.wingNameLower,
      unitNumberLower: unitDoc.unitNumberLower,
      memberId: authUser._id,
    });
    if (!hasAccess) {
      return next(createHttpError('Forbidden: member is not part of your unit.', 403));
    }

    const payload = req.body || {};
    const imageRaw =
      payload.image !== undefined
        ? payload.image
        : payload.imageUrl !== undefined
          ? payload.imageUrl
          : payload.profilePhoto !== undefined
            ? payload.profilePhoto
            : payload.profileImage;
    const phoneRaw = getLastBodyValue(
      payload.phoneNumber !== undefined ? payload.phoneNumber : payload.phone
    );
    const category = getLastBodyValue(payload.category);
    const name = getLastBodyValue(payload.name);
    const countryCode = getLastBodyValue(payload.countryCode);

    const updates = {};

    if (countryCode !== undefined) {
      updates.countryCode = normalizeCountryCode(countryCode);
    }

    if (category !== undefined) {
      const normalizedCategory = normalizeString(category).toLowerCase();
      if (!ALLOWED_CATEGORIES.has(normalizedCategory)) {
        return next(createHttpError('category must be one of adult, child.', 400));
      }
      updates.category = normalizedCategory;
    }

    if (name !== undefined) {
      const nm = toTitleCaseName(name);
      if (!nm) return next(createHttpError('name cannot be empty.', 400));
      updates.name = nm;
    }

    if (imageRaw !== undefined) {
      const trimmed = normalizeString(getLastBodyValue(imageRaw));
      if (!trimmed) {
        updates.imageUrl = null;
      } else {
        try {
          updates.imageUrl = await normalizeImageInputToStorageUrl({
            value: trimmed,
            fieldLabel: 'Image',
            keyPrefix: `family/${String(unitDoc._id)}/members`,
            fileName: `member-${Date.now()}`,
          });
        } catch (e) {
          return next(createHttpError(e.message, 400));
        }
      }
    }

    if (phoneRaw !== undefined) {
      const digits = normalizeDigits(phoneRaw || '');
      if (digits && (digits.length < 10 || digits.length > 12)) {
        return next(createHttpError('Please enter a valid phone number.', 400));
      }

      const effectiveCode = updates.countryCode || doc.countryCode || '+91';
      const comparable = digits ? getComparablePhoneNumber({ countryCode: effectiveCode, phoneNumber: digits }) : null;

      const effectiveCategory = updates.category || doc.category;
      if (effectiveCategory === 'adult' && !digits) {
        return next(createHttpError('phoneNumber is required for adult.', 400));
      }

      if (digits) {
        const existingUser = await User.exists({ phoneNumber: digits });
        if (existingUser) return next(createHttpError('This phone number already exists in the system.', 409));

        const SuperAdmin = require('../../model/superAdminSchema');
        const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

        const fmExists = await FamilyMember.exists({ phoneDigits: digits, _id: { $ne: doc._id } });
        if (fmExists) return next(createHttpError('This phone number already exists in the system.', 409));

        const saExists = await SuperAdmin.exists({ phoneNumber: digits });
        if (saExists) return next(createHttpError('This phone number already exists in the system.', 409));

        const adminExists = await lookupSocietyAdminByMobile(digits);
        if (adminExists) return next(createHttpError('This phone number already exists in the system.', 409));
      }

      if (comparable) {
        const dupComparable = await FamilyMember.exists({ comparablePhone: comparable, _id: { $ne: doc._id } });
        if (dupComparable) return next(createHttpError('This phone number already exists in the system.', 409));
      }

      updates.phoneNumber = digits ? phoneRaw : null;
      updates.phoneDigits = digits || null;
      updates.comparablePhone = comparable || null;
    }

    if (Object.keys(updates).length === 0) {
      return sendSuccessResponse(res, 200, 'No changes provided.', {
        data: {
          id: String(doc._id),
          unitId: String(doc.unitId),
          category: doc.category,
          name: doc.name,
          countryCode: doc.countryCode,
          phoneNumber: doc.phoneNumber,
          imageUrl: doc.imageUrl,
          status: getFamilyDisplayStatus({ category: doc.category, status: doc.status }),
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        },
      });
    }

    Object.assign(doc, updates);

    const digitsNow = doc.phoneDigits || null;
    if (digitsNow) {
      const matchedUser = await User.findOne({ phoneNumber: digitsNow });
      if (matchedUser) {
        doc.status = 'Active on GatePal™';
        doc.linkedUserId = matchedUser._id;
      } else {
        doc.status = 'Inactive on GatePal™';
        doc.linkedUserId = null;
      }
    } else {
      doc.status = 'Inactive on GatePal™';
      doc.linkedUserId = null;
    }

    await doc.save();

    return sendSuccessResponse(res, 200, 'Family member updated successfully.', {
      data: {
        id: String(doc._id),
        unitId: String(doc.unitId),
        category: doc.category,
        name: doc.name,
        countryCode: doc.countryCode,
        phoneNumber: doc.phoneNumber,
        imageUrl: doc.imageUrl,
        status: getFamilyDisplayStatus({ category: doc.category, status: doc.status }),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update family member'));
  }
};

const deleteFamilyMember = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));

    const memberId = normalizeString((req.params && req.params.memberId) || '');
    if (!memberId) return next(createHttpError('memberId path parameter is required.', 400));
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return next(createHttpError('Invalid member ID format.', 400));
    }

    const doc = await FamilyMember.findById(memberId);
    if (!doc) {
      const targetUser = await User.findById(memberId);
      if (!targetUser) return next(createHttpError('Family member not found.', 404));

      const authUnits = await MemberUnit.find({ memberId: authUser._id }).lean();
      const userUnits = await MemberUnit.find({ memberId: targetUser._id }).lean();

      const overlapping = userUnits.filter(
        (uu) =>
          (uu.occupantType === 'unit_owner_family_member' || uu.occupantType === 'tenant_family_member') &&
          authUnits.some(
            (au) =>
              String(au.societyId) === String(uu.societyId) &&
              au.wingNameLower === uu.wingNameLower &&
              au.unitNumberLower === uu.unitNumberLower
          )
      );

      if (overlapping.length === 0) {
        return next(createHttpError('Forbidden: you do not own this unit.', 403));
      }

      await MemberUnit.deleteMany({ _id: { $in: overlapping.map((unit) => unit._id) } });
      await invalidateFamilyCacheForUnits({ authUserId: authUser._id, unitDocs: overlapping });
      return sendSuccessResponse(res, 200, 'Family member deleted successfully.');
    }

    const unitDoc = await MemberUnit.findById(doc.unitId);
    if (!unitDoc) return next(createHttpError('Unit not found.', 404));
    if (String(unitDoc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit.', 403));
    }

    await doc.deleteOne();
    await invalidateFamilyCacheForUnits({ authUserId: authUser._id, unitDocs: [unitDoc] });

    return sendSuccessResponse(res, 200, 'Family member deleted successfully.');
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete family member'));
  }
};

const getFamilyMemberById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));

    const memberId = normalizeString((req.params && req.params.memberId) || '');
    if (!memberId) return next(createHttpError('memberId path parameter is required.', 400));
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return next(createHttpError('Invalid member ID format.', 400));
    }

    const fm = await FamilyMember.findById(memberId).lean();
    if (fm) {
      const unitDoc = await MemberUnit.findById(fm.unitId).lean();
      if (!unitDoc) return next(createHttpError('Unit not found.', 404));
      const hasAccess = await MemberUnit.exists({
        societyId: unitDoc.societyId,
        wingNameLower: unitDoc.wingNameLower,
        unitNumberLower: unitDoc.unitNumberLower,
        memberId: authUser._id,
      });
      if (!hasAccess) {
        return next(createHttpError('Forbidden: member is not part of your unit.', 403));
      }

      return sendSuccessResponse(res, 200, 'Family member fetched successfully.', {
        data: {
          id: String(fm._id),
          unitId: String(fm.unitId),
          category: fm.category,
          name: fm.name,
          countryCode: fm.countryCode,
          phoneNumber: fm.phoneNumber,
          imageUrl: fm.imageUrl,
          occupantType: unitDoc.occupantType || null,
          status: getFamilyDisplayStatus({ category: fm.category, status: fm.status }),
          createdAt: fm.createdAt,
          updatedAt: fm.updatedAt,
        },
      });
    }

    const targetUser = await User.findById(memberId).lean();
    if (!targetUser) {
      return next(createHttpError('Family member not found.', 404));
    }

    const authUnits = await MemberUnit.find({ memberId: authUser._id }).lean();
    const userUnits = await MemberUnit.find({ memberId: targetUser._id }).lean();

    const matchingUnit = userUnits.find((uu) =>
      authUnits.some(
        (au) =>
          String(au.societyId) === String(uu.societyId) &&
          au.wingNameLower === uu.wingNameLower &&
          au.unitNumberLower === uu.unitNumberLower
      )
    );

    if (!matchingUnit) {
      return next(createHttpError('Forbidden: member is not part of your unit.', 403));
    }

    return sendSuccessResponse(res, 200, 'Family member fetched successfully.', {
      data: {
        id: String(targetUser._id),
        unitId: String(matchingUnit._id),
        category: 'adult',
        name: targetUser.fullName || null,
        countryCode: targetUser.countryCode || '+91',
        phoneNumber: targetUser.phoneNumber || null,
        imageUrl: targetUser.profilePhoto || null,
        occupantType: matchingUnit.occupantType || null,
        status: 'Active on GatePal™',
        createdAt: targetUser.createdAt,
        updatedAt: targetUser.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch family member'));
  }
};

module.exports = {
  addFamilyMember,
  validateAddFamilyInput,
  getFamilyMembersByUnit,
  updateFamilyMember,
  deleteFamilyMember,
  getFamilyMemberById,
};
