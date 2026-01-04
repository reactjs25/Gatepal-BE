const Vehicle = require('../../model/vehicleSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');
const { buildCanonicalUnitId, assertUnitAccess } = require('../../utils/unitAccess');

const ALLOWED_TYPES = new Set(['Two-Wheeler', 'Four-Wheeler', 'Other']);
const MAX_VEHICLES_BY_TYPE = {
  'Two-Wheeler': 2,
  'Four-Wheeler': 2,
  Other: 3,
};


const validateVehiclePayload = (payload = {}) => {
  const vehicleType = normalizeString(payload.vehicleType);
  const name = toTitleCaseName(payload.name);
  const rawNumber = normalizeString(payload.vehicleNumber).toUpperCase();
  const isElectric = Boolean(payload.isElectric);

  if (!vehicleType || !ALLOWED_TYPES.has(vehicleType)) {
    throw createHttpError('Vehicle type must be one of Two-Wheeler, Four-Wheeler, Other.', 400);
  }
  if (!name) throw createHttpError('Vehicle name is required.', 400);
  if (!isElectric && !rawNumber) {
    throw createHttpError('Vehicle number is required for non-electric vehicles.', 400);
  }
  if (rawNumber && !/^[A-Z0-9]+$/.test(rawNumber)) {
    throw createHttpError('Vehicle number must be alphanumeric without spaces, slashes, or dashes.', 400);
  }

  return { vehicleType, name, vehicleNumber: rawNumber || undefined, isElectric };
};

const assertVehicleTypeLimit = async ({ unitId, vehicleType, excludeVehicleId }) => {
  const max = MAX_VEHICLES_BY_TYPE[vehicleType];
  if (!max) return;
  const query = { unitId, vehicleType, deletedAt: null };
  if (excludeVehicleId) {
    query.vehicleId = { $ne: excludeVehicleId };
  }
  const count = await Vehicle.countDocuments(query);
  if (count >= max) {
    throw createHttpError(`Maximum ${max} ${vehicleType} vehicles allowed per unit.`, 400);
  }
};

const addVehicle = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

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
      validated = validateVehiclePayload(req.body || {});
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    if (validated.vehicleNumber) {
      const exists = await Vehicle.exists({
        unitId: canonicalUnitId,
        vehicleNumber: validated.vehicleNumber,
        deletedAt: null,
      });
      if (exists) {
        return next(createHttpError('A vehicle with this number already exists for the unit', 409));
      }
    }

    try {
      await assertVehicleTypeLimit({ unitId: canonicalUnitId, vehicleType: validated.vehicleType });
    } catch (e) {
      return next(e);
    }

    const doc = await Vehicle.create({
      unitId: canonicalUnitId,
      memberId: authUser._id,
      vehicleType: validated.vehicleType,
      name: validated.name,
      vehicleNumber: validated.vehicleNumber,
      isElectric: validated.isElectric,
    });

    return sendSuccessResponse(res, 201, 'Vehicle details saved successfully.', {
      data: {
        vehicleId: doc.vehicleId,
        unitId: String(unitDoc._id),
        memberId: String(doc.memberId),
        vehicleType: doc.vehicleType,
        name: doc.name,
        vehicleNumber: doc.vehicleNumber,
        isElectric: doc.isElectric,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add vehicle'));
  }
};

const getVehiclesByUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const items = await Vehicle.find({ unitId: canonicalUnitId, deletedAt: null }).sort({ createdAt: -1 }).lean();

    return sendSuccessResponse(res, 200, 'Vehicles fetched successfully', {
      data: items.map((v) => ({
        vehicleId: v.vehicleId,
        unitId: String(unitDoc._id),
        memberId: String(v.memberId),
        vehicleType: v.vehicleType,
        name: v.name,
        vehicleNumber: v.vehicleNumber,
        isElectric: v.isElectric,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch vehicles'));
  }
};

const editVehicle = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const vehicleId = normalizeString((req.params && req.params.vehicleId) || '');
    if (!vehicleId) return next(createHttpError('vehicleId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Vehicle.findOne({ vehicleId });
    if (!doc) return next(createHttpError('Vehicle not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Vehicle does not belong to the provided unit', 403));
    }

    let validated;
    try {
      validated = validateVehiclePayload(req.body || {});
    } catch (e) {
      return next(e);
    }

    if (validated.vehicleNumber && validated.vehicleNumber !== doc.vehicleNumber) {
      const dup = await Vehicle.exists({
        unitId: canonicalUnitId,
        vehicleNumber: validated.vehicleNumber,
        deletedAt: null,
      });
      if (dup) return next(createHttpError('A vehicle with this number already exists for the unit', 409));
    }

    try {
      await assertVehicleTypeLimit({
        unitId: canonicalUnitId,
        vehicleType: validated.vehicleType,
        excludeVehicleId: vehicleId,
      });
    } catch (e) {
      return next(e);
    }

    doc.vehicleType = validated.vehicleType;
    doc.name = validated.name;
    doc.vehicleNumber = validated.vehicleNumber;
    doc.isElectric = validated.isElectric;
    doc.memberId = authUser._id;
    await doc.save();

    return sendSuccessResponse(res, 200, 'Vehicle details update successfully.', {
      data: {
        vehicleId: doc.vehicleId,
        unitId: String(unitDoc._id),
        memberId: String(doc.memberId),
        vehicleType: doc.vehicleType,
        name: doc.name,
        vehicleNumber: doc.vehicleNumber,
        isElectric: doc.isElectric,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update vehicle'));
  }
};

const getVehicleById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const vehicleId = normalizeString((req.params && req.params.vehicleId) || '');
    if (!vehicleId) return next(createHttpError('vehicleId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Vehicle.findOne({ vehicleId }).lean();
    if (!doc) return next(createHttpError('Vehicle not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Vehicle does not belong to the provided unit', 403));
    }
    if (doc.deletedAt) {
      return next(createHttpError('Vehicle not found', 404));
    }

    return sendSuccessResponse(res, 200, 'Vehicle fetched successfully', {
      data: {
        vehicleId: doc.vehicleId,
        unitId: String(unitDoc._id),
        memberId: String(doc.memberId),
        vehicleType: doc.vehicleType,
        name: doc.name,
        vehicleNumber: doc.vehicleNumber,
        isElectric: doc.isElectric,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch vehicle'));
  }
};

const deleteVehicle = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized', 401));

    const unitIdCandidate = normalizeString((req.params && (req.params.unitId || req.params.id)) || '');
    const vehicleId = normalizeString((req.params && req.params.vehicleId) || '');
    if (!vehicleId) return next(createHttpError('vehicleId path parameter is required', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);

    const doc = await Vehicle.findOne({ vehicleId });
    if (!doc) return next(createHttpError('Vehicle not found', 404));
    if (doc.unitId !== canonicalUnitId) {
      return next(createHttpError('Vehicle does not belong to the provided unit', 403));
    }

    const deletedAt = new Date();
    await Vehicle.findOneAndUpdate(
      { vehicleId, unitId: canonicalUnitId },
      { $set: { memberId: authUser._id, deletedAt } },
      { new: true }
    );

    return sendSuccessResponse(res, 200, 'Vehicle details removed successfully.', {
      data: { vehicleId, unitId: String(unitDoc._id), deletedAt },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove vehicle'));
  }
};

module.exports = {
  addVehicle,
  getVehiclesByUnit,
  editVehicle,
  deleteVehicle,
  getVehicleById,
};
