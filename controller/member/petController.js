const Pet = require('../../model/petSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');
const { buildCanonicalUnitId, assertUnitAccess } = require('../../utils/unitAccess');
const { normalizeImageInputToStorageUrl } = require('../../utils/imageDataUrl');

const ALLOWED_PET_TYPES = new Set(['Dog', 'Cat', 'Parrot', 'Rabbit', 'Hamsters', 'Others']);
const ALLOWED_VACCINATION_STATUSES = new Set([
  'Fully Vaccinated',
  'Partially Vaccinated',
  'Not Vaccinated',
  'Vaccination Not Required',
]);

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
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
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const ensureCertificateMaybe = ({ value, fieldLabel }) => {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  return trimmed;
};

const validatePetPayload = (payload = {}) => {
  const petType = normalizeString(getLastBodyValue(payload.petType));
  const name = toTitleCaseName(getLastBodyValue(payload.name));
  const vaccinationStatus = normalizeString(getLastBodyValue(payload.vaccinationStatus));

  const lastVaccinationDate = toDateOrNull(getLastBodyValue(payload.lastVaccinationDate));
  const nextVaccinationDueDate = toDateOrNull(getLastBodyValue(payload.nextVaccinationDueDate));

  const certificateRaw = payload.certificate !== undefined
    ? payload.certificate
    : payload.certificateUrl !== undefined
      ? payload.certificateUrl
      : payload.vaccinationCertificate !== undefined
        ? payload.vaccinationCertificate
        : payload.image !== undefined
          ? payload.image
          : payload.imageUrl;
  const certificateInput = certificateRaw !== undefined
    ? ensureCertificateMaybe({ value: getLastBodyValue(certificateRaw), fieldLabel: 'Vaccination certificate' })
    : null;

  if (!petType || !ALLOWED_PET_TYPES.has(petType)) {
    throw createHttpError('petType must be one of Dog, Cat, Parrot, Rabbit, Hamsters, Others.', 400);
  }
  if (!name) throw createHttpError('name is required.', 400);
  if (!vaccinationStatus || !ALLOWED_VACCINATION_STATUSES.has(vaccinationStatus)) {
    throw createHttpError('vaccinationStatus must be one of Fully Vaccinated, Partially Vaccinated, Not Vaccinated, Vaccination Not Required.', 400);
  }

  if ((vaccinationStatus === 'Fully Vaccinated' || vaccinationStatus === 'Partially Vaccinated') && !lastVaccinationDate) {
    throw createHttpError('lastVaccinationDate is required for the selected vaccinationStatus.', 400);
  }

  return {
    petType,
    name,
    vaccinationStatus,
    lastVaccinationDate,
    nextVaccinationDueDate,
    certificateInput,
  };
};

const validatePetPatchPayload = (payload = {}) => {
  const out = {};
  if (payload.petType !== undefined) {
    const petType = normalizeString(getLastBodyValue(payload.petType));
    if (!petType || !ALLOWED_PET_TYPES.has(petType)) {
      throw createHttpError('petType must be one of Dog, Cat, Parrot, Rabbit, Hamsters, Others.', 400);
    }
    out.petType = petType;
  }
  if (payload.name !== undefined) {
    const name = toTitleCaseName(getLastBodyValue(payload.name));
    if (!name) throw createHttpError('name is required.', 400);
    out.name = name;
  }
  if (payload.vaccinationStatus !== undefined) {
    const vaccinationStatus = normalizeString(getLastBodyValue(payload.vaccinationStatus));
    if (!vaccinationStatus || !ALLOWED_VACCINATION_STATUSES.has(vaccinationStatus)) {
      throw createHttpError('vaccinationStatus must be one of Fully Vaccinated, Partially Vaccinated, Not Vaccinated, Vaccination Not Required.', 400);
    }
    out.vaccinationStatus = vaccinationStatus;
  }
  if (payload.lastVaccinationDate !== undefined) {
    out.lastVaccinationDate = toDateOrNull(getLastBodyValue(payload.lastVaccinationDate));
  }
  if (payload.nextVaccinationDueDate !== undefined) {
    out.nextVaccinationDueDate = toDateOrNull(getLastBodyValue(payload.nextVaccinationDueDate));
  }
  const certificateRaw = payload.certificate !== undefined
    ? payload.certificate
    : payload.certificateUrl !== undefined
      ? payload.certificateUrl
      : payload.vaccinationCertificate !== undefined
        ? payload.vaccinationCertificate
        : payload.image !== undefined
          ? payload.image
          : payload.imageUrl;
  if (certificateRaw !== undefined) {
    out.certificateInput = ensureCertificateMaybe({ value: getLastBodyValue(certificateRaw), fieldLabel: 'Vaccination certificate' });
  }
  return out;
};

const addPet = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
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
      return next(createHttpError('A pet with the same name and type already exists for the unit.', 409));
    }

    let certificateUrl = validated.certificateInput || null;
    if (certificateUrl) {
      try {
        certificateUrl = await normalizeImageInputToStorageUrl({
          value: certificateUrl,
          fieldLabel: 'Vaccination certificate',
          keyPrefix: `pets/${canonicalUnitId}/certificates`,
          fileName: `certificate-${Date.now()}`,
        });
      } catch (e) {
        return next(createHttpError(e.message, 400));
      }
    }

    const doc = await Pet.create({
      unitId: canonicalUnitId,
      memberId: authUser._id,
      petType: validated.petType,
      name: validated.name,
      vaccinationStatus: validated.vaccinationStatus,
      lastVaccinationDate: validated.lastVaccinationDate,
      nextVaccinationDueDate: validated.nextVaccinationDueDate,
      certificateUrl,
    });

    return sendSuccessResponse(res, 201, 'Pet details saved successfully.', {
      data: {
        petId: doc.petId,
        unitId: String(unitDoc._id),
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
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    console.info('[pets:list] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const items = await Pet.find({ unitId: canonicalUnitId, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccessResponse(res, 200, 'Pets fetched successfully.', {
      data: items.map((p) => ({
        petId: p.petId,
        unitId: String(unitDoc._id),
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
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    console.info('[pets:edit] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required.', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId });
    if (!doc) return next(createHttpError('Pet not found.', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit.', 403));
    }

    let validated;
    try {
      validated = validatePetPatchPayload(req.body || {});
    } catch (e) {
      return next(e);
    }

    if (validated.vaccinationStatus !== undefined) {
      const vs = validated.vaccinationStatus;
      if ((vs === 'Fully Vaccinated' || vs === 'Partially Vaccinated') && validated.lastVaccinationDate === undefined && !doc.lastVaccinationDate) {
        return next(createHttpError('lastVaccinationDate is required for the selected vaccinationStatus.', 400));
      }
    }

    const nextName = validated.name !== undefined ? validated.name : doc.name;
    const nextType = validated.petType !== undefined ? validated.petType : doc.petType;
    if (nextName !== doc.name || nextType !== doc.petType) {
      const dup = await Pet.exists({ unitId: canonicalUnitId, name: nextName, petType: nextType, deletedAt: null });
      if (dup) return next(createHttpError('A pet with the same name and type already exists for the unit.', 409));
    }

    if (validated.petType !== undefined) doc.petType = validated.petType;
    if (validated.name !== undefined) doc.name = validated.name;
    if (validated.vaccinationStatus !== undefined) doc.vaccinationStatus = validated.vaccinationStatus;
    if (validated.lastVaccinationDate !== undefined) doc.lastVaccinationDate = validated.lastVaccinationDate;
    if (validated.nextVaccinationDueDate !== undefined) doc.nextVaccinationDueDate = validated.nextVaccinationDueDate;
    if (validated.certificateInput !== undefined) {
      if (validated.certificateInput === null) {
        doc.certificateUrl = null;
      } else {
        try {
          doc.certificateUrl = await normalizeImageInputToStorageUrl({
            value: validated.certificateInput,
            fieldLabel: 'Vaccination certificate',
            keyPrefix: `pets/${canonicalUnitId}/certificates`,
            fileName: `certificate-${Date.now()}`,
          });
        } catch (e) {
          return next(createHttpError(e.message, 400));
        }
      }
    }
    doc.memberId = authUser._id;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Pet details update successfully.', {
      data: {
        petId: doc.petId,
        unitId: String(unitDoc._id),
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
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    console.info('[pets:get] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required.', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId }).lean();
    if (!doc) return next(createHttpError('Pet not found.', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit.', 403));
    }
    if (doc.deletedAt) {
      return next(createHttpError('Pet not found.', 404));
    }

    return sendSuccessResponse(res, 200, 'Pet fetched successfully.', {
      data: {
        petId: doc.petId,
        unitId: String(unitDoc._id),
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
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    console.info('[pets:delete] invoked', { userId: String(authUser._id) });

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const petId = normalizeString((req.params && req.params.petId) || '');
    if (!petId) return next(createHttpError('petId path parameter is required.', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Pet.findOne({ petId });
    if (!doc) return next(createHttpError('Pet not found.', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Pet does not belong to the provided unit.', 403));
    }

    const deletedAt = new Date();
    await Pet.findOneAndUpdate(
      { petId, unitId: canonicalUnitId },
      { $set: { memberId: authUser._id, deletedAt } },
      { new: true }
    );

    return sendSuccessResponse(res, 200, 'Pet details removed successfully.', {
      data: { petId, unitId: String(unitDoc._id), deletedAt },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove pet'));
  }
};

module.exports = {
  addPet,
  getPetsByUnit,
  editPet,
  deletePet,
  getPetById,
};
