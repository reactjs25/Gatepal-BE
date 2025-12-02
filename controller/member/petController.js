const mongoose = require('mongoose');
const Pet = require('../../model/petSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');

const ALLOWED_PET_TYPES = new Set(['Dog', 'Cat', 'Parrot', 'Rabbit', 'Hamsters', 'Others']);
const ALLOWED_VACCINATION_STATUSES = new Set([
  'Fully Vaccinated',
  'Partially Vaccinated',
  'Not Vaccinated',
  'Vaccination Not Required',
]);


const normalizeString = (v) => (v || '').toString().trim();

const buildCanonicalUnitId = (unitDoc) =>
  `${String(unitDoc.societyId)}:${unitDoc.wingNameLower}:${unitDoc.unitNumberLower}`;

const assertUnitAccess = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const hasAccess = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
  });

  if (!hasAccess) {
    throw createHttpError('Forbidden: you do not have access to this unit', 403);
  }

  return unitDoc;
};

const assertMemberUnitOwnership = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const isOwner = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
    occupantType: 'unit_owner',
  });

  if (!isOwner) {
    throw createHttpError('Forbidden: only unit owner can delete pets', 403);
  }

  return unitDoc;
};

const assertUnitResidentAccess = async ({ unitId, authUser }) => {
  const id = normalizeString(unitId);
  if (!id) throw createHttpError('unitId path parameter is required', 400);
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError('Invalid unit ID format', 400);
  const unitDoc = await MemberUnit.findById(id);
  if (!unitDoc) throw createHttpError('Unit not found', 404);

  const isResident = await MemberUnit.exists({
    societyId: unitDoc.societyId,
    wingNameLower: unitDoc.wingNameLower,
    unitNumberLower: unitDoc.unitNumberLower,
    memberId: authUser._id,
    occupancyStatus: 'currently_residing',
  });

  if (!isResident) {
    throw createHttpError('Forbidden: only residents of this unit can delete pets', 403);
  }

  return unitDoc;
};

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

const validatePetPayload = (payload = {}) => {
  const petType = normalizeString(payload.petType);
  const name = normalizeString(payload.name);
  const vaccinationStatus = normalizeString(payload.vaccinationStatus);

  const lastVaccinationDate = toDateOrNull(payload.lastVaccinationDate);
  const nextVaccinationDueDate = toDateOrNull(payload.nextVaccinationDueDate);

  const certificateUrl = normalizeString(payload.certificateUrl);

  if (!petType || !ALLOWED_PET_TYPES.has(petType)) {
    throw createHttpError('petType must be one of Dog, Cat, Parrot, Rabbit, Hamsters, Others', 400);
  }
  if (!name) throw createHttpError('name is required', 400);
  if (!vaccinationStatus || !ALLOWED_VACCINATION_STATUSES.has(vaccinationStatus)) {
    throw createHttpError('vaccinationStatus must be one of Fully Vaccinated, Partially Vaccinated, Not Vaccinated, Vaccination Not Required', 400);
  }

  if ((vaccinationStatus === 'Fully Vaccinated' || vaccinationStatus === 'Partially Vaccinated') && !lastVaccinationDate) {
    throw createHttpError('lastVaccinationDate is required for the selected vaccinationStatus', 400);
  }

  return {
    petType,
    name,
    vaccinationStatus,
    lastVaccinationDate,
    nextVaccinationDueDate,
    certificateUrl: certificateUrl || null,
  };
};

const validatePetPatchPayload = (payload = {}) => {
  const out = {};
  if (payload.petType !== undefined) {
    const petType = normalizeString(payload.petType);
    if (!petType || !ALLOWED_PET_TYPES.has(petType)) {
      throw createHttpError('petType must be one of Dog, Cat, Parrot, Rabbit, Hamsters, Others', 400);
    }
    out.petType = petType;
  }
  if (payload.name !== undefined) {
    const name = normalizeString(payload.name);
    if (!name) throw createHttpError('name is required', 400);
    out.name = name;
  }
  if (payload.vaccinationStatus !== undefined) {
    const vaccinationStatus = normalizeString(payload.vaccinationStatus);
    if (!vaccinationStatus || !ALLOWED_VACCINATION_STATUSES.has(vaccinationStatus)) {
      throw createHttpError('vaccinationStatus must be one of Fully Vaccinated, Partially Vaccinated, Not Vaccinated, Vaccination Not Required', 400);
    }
    out.vaccinationStatus = vaccinationStatus;
  }
  if (payload.lastVaccinationDate !== undefined) {
    out.lastVaccinationDate = toDateOrNull(payload.lastVaccinationDate);
  }
  if (payload.nextVaccinationDueDate !== undefined) {
    out.nextVaccinationDueDate = toDateOrNull(payload.nextVaccinationDueDate);
  }
  if (payload.certificateUrl !== undefined) {
    out.certificateUrl = normalizeString(payload.certificateUrl) || null;
  }
  return out;
};

const addPet = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    console.info('[pets:add] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString(
      (req.params && (req.params.unitId || req.params.id)) || (req.body || {}).unitId
    );

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    let validated;
    try {
      validated = validatePetPatchPayload(req.body || {});
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const exists = await Pet.exists({ unitId: canonicalUnitId, name: validated.name, petType: validated.petType, deletedAt: null });
    if (exists) {
      return next(createHttpError('A pet with the same name and type already exists for the unit', 409));
    }

    const doc = await Pet.create({
      unitId: canonicalUnitId,
      memberId: authUser._id,
      petType: validated.petType,
      name: validated.name,
      vaccinationStatus: validated.vaccinationStatus,
      lastVaccinationDate: validated.lastVaccinationDate,
      nextVaccinationDueDate: validated.nextVaccinationDueDate,
      certificateUrl: validated.certificateUrl || null,
    });

    return sendSuccessResponse(res, 201, 'Pet added successfully', {
      data: {
        petId: doc.petId,
        unitId: doc.unitId,
        memberId: String(doc.memberId),
        petType: doc.petType,
        name: doc.name,
        vaccinationStatus: doc.vaccinationStatus,
        lastVaccinationDate: toDateOnly(doc.lastVaccinationDate),
        nextVaccinationDueDate: toDateOnly(doc.nextVaccinationDueDate),
        certificateUrl: doc.certificateUrl,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add pet'));
  }
};

const getPetsByUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    console.info('[pets:list] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const page = Math.max(1, Number((req.query && req.query.page) || 1));
    const limit = Math.max(1, Math.min(100, Number((req.query && req.query.limit) || 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Pet.find({ unitId: canonicalUnitId, deletedAt: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Pet.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
    ]);

    return sendSuccessResponse(res, 200, 'Pets fetched successfully', {
      data: items.map((p) => ({
        petId: p.petId,
        unitId: p.unitId,
        memberId: String(p.memberId),
        petType: p.petType,
        name: p.name,
        vaccinationStatus: p.vaccinationStatus,
        lastVaccinationDate: toDateOnly(p.lastVaccinationDate),
        nextVaccinationDueDate: toDateOnly(p.nextVaccinationDueDate),
        certificateUrl: p.certificateUrl,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),

    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch pets'));
  }
};

const editPet = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    console.info('[pets:edit] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId });
    if (!doc) return next(createHttpError('Pet not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit', 403));
    }

    let validated;
    try {
      validated = validatePetPayload(req.body || {});
    } catch (e) {
      return next(e);
    }

    const nextName = validated.name !== undefined ? validated.name : doc.name;
    const nextType = validated.petType !== undefined ? validated.petType : doc.petType;
    if (nextName !== doc.name || nextType !== doc.petType) {
      const dup = await Pet.exists({ unitId: canonicalUnitId, name: nextName, petType: nextType, deletedAt: null });
      if (dup) return next(createHttpError('A pet with the same name and type already exists for the unit', 409));
    }

    if (validated.petType !== undefined) doc.petType = validated.petType;
    if (validated.name !== undefined) doc.name = validated.name;
    if (validated.vaccinationStatus !== undefined) doc.vaccinationStatus = validated.vaccinationStatus;
    if (validated.lastVaccinationDate !== undefined) doc.lastVaccinationDate = validated.lastVaccinationDate;
    if (validated.nextVaccinationDueDate !== undefined) doc.nextVaccinationDueDate = validated.nextVaccinationDueDate;
    if (validated.certificateUrl !== undefined) doc.certificateUrl = validated.certificateUrl;
    doc.memberId = authUser._id;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Pet updated successfully', {
      data: {
        petId: doc.petId,
        unitId: doc.unitId,
        memberId: String(doc.memberId),
        petType: doc.petType,
        name: doc.name,
        vaccinationStatus: doc.vaccinationStatus,
        lastVaccinationDate: toDateOnly(doc.lastVaccinationDate),
        nextVaccinationDueDate: toDateOnly(doc.nextVaccinationDueDate),
        certificateUrl: doc.certificateUrl,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update pet'));
  }
};

const getPetById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    console.info('[pets:get] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId }).lean();
    if (!doc) return next(createHttpError('Pet not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit', 403));
    }
    if (doc.deletedAt) {
      return next(createHttpError('Pet not found', 404));
    }

    return sendSuccessResponse(res, 200, 'Pet fetched successfully', {
      data: {
        petId: doc.petId,
        unitId: doc.unitId,
        memberId: String(doc.memberId),
        petType: doc.petType,
        name: doc.name,
        vaccinationStatus: doc.vaccinationStatus,
        lastVaccinationDate: toDateOnly(doc.lastVaccinationDate),
        nextVaccinationDueDate: toDateOnly(doc.nextVaccinationDueDate),
        certificateUrl: doc.certificateUrl,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch pet'));
  }
};

const deletePet = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));
    console.info('[pets:delete] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId });
    if (!doc) return next(createHttpError('Pet not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit', 403));
    }

    const deletedAt = new Date();
    await Pet.findOneAndUpdate(
      { petId, unitId: canonicalUnitId },
      { $set: { memberId: authUser._id, deletedAt } },
      { new: true }
    );

    return sendSuccessResponse(res, 200, 'Pet deleted successfully', {
      data: { petId, unitId: canonicalUnitId, deletedAt },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to delete pet'));
  }
};

module.exports = {
  addPet,
  getPetsByUnit,
  editPet,
  deletePet,
  getPetById,
};
