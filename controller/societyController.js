const Society = require('../model/societySchema');
const MissingUnitRequest = require('../model/missingUnitRequestSchema');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { ensureAdminListIsUnique, normalizeAdminEmail, normalizeAdminMobile } = require('../utils/societyAdminUtils');
const { sendSuccessResponse } = require('../utils/response');

const PIN_MIN = 100000;
const PIN_MAX = 999999;

const generateCandidatePin = () =>
  Math.floor(Math.random() * (PIN_MAX - PIN_MIN + 1)) + PIN_MIN;

const generateUniqueSocietyPin = async () => {
  const maxAttempts = 25;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateCandidatePin().toString();
    const exists = await Society.exists({ societyPin: candidate });
    if (!exists) {
      return candidate;
    }
  }

  const fallback = `${Date.now()}`;
  const fallbackExists = await Society.exists({ societyPin: fallback });
  if (!fallbackExists) {
    return fallback;
  }

  throw createHttpError('Unable to generate a unique Society PIN. Please try again later.', 500);
};

const normalizeIncomingAdmins = (admins = []) =>
  Array.isArray(admins)
    ? admins.map((admin = {}) => ({
        ...admin,
        email: admin.email ? normalizeAdminEmail(admin.email) : admin.email,
        mobile: admin.mobile ? normalizeAdminMobile(admin.mobile) : admin.mobile,
      }))
    : [];

const computeEngagementTotals = (engagement = {}) => {
  const baseRate = engagement.baseRate;
  let gst = engagement.gst;
  let total = engagement.total;

  if (gst === undefined && baseRate !== undefined) {
    gst = baseRate * 0.18;
  }

  if (total === undefined && baseRate !== undefined) {
    total = baseRate + (gst !== undefined ? gst : 0);
  }

  return { gst, total };
};

const createSociety = async (req, res, next) => {
  try {
    const {
      societyName,
      address,
      city,
      country,
      latitude,
      longitude,
      status,
      maintenanceDueDate,
      notes,
      structure,
      entryGates,
      exitGates,
      societyAdmins,
      engagement: engagementInput,
      vehicleLimits: vehicleLimitsInput,
    } = req.body;

    const engagement = engagementInput || {};
    const totals = computeEngagementTotals(engagement);
    const normalizedSocietyAdmins = Array.isArray(societyAdmins)
      ? normalizeIncomingAdmins(societyAdmins)
      : undefined;

    if (normalizedSocietyAdmins?.length > 0) {
      await ensureAdminListIsUnique(normalizedSocietyAdmins, { skipDbCheck: true });
    }

    const requestedPin =
      typeof req.body.societyPin === 'string' ? req.body.societyPin.trim() : '';

    let societyPinToUse = requestedPin;
    if (!societyPinToUse) {
      societyPinToUse = await generateUniqueSocietyPin();
    } else {
      const duplicatePin = await Society.exists({ societyPin: societyPinToUse });
      if (duplicatePin) {
        societyPinToUse = await generateUniqueSocietyPin();
      }
    }

    const newSociety = new Society({
      societyName,
      societyPin: societyPinToUse,
      address,
      city,
      country,
      latitude,
      longitude,
      status,
      maintenanceDueDate,
      notes,
      structure,
      entryGates,
      exitGates,
      societyAdmins: normalizedSocietyAdmins,
      engagement: {
        ...engagement,
        gst: totals.gst,
        total: totals.total,
      },
      vehicleLimits: vehicleLimitsInput,
    });

    await newSociety.save();
    return sendSuccessResponse(res, 201, 'Society created successfully.', { data: newSociety });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to create society'));
  }
};

const getAllSociety = async (req, res, next) => {
  try {
    
    const now = new Date();
    await Society.updateMany(
      {
        status: { $in: ['Active', 'Trial'] },
        'engagement.endDate': { $lt: now },
      },
      { $set: { status: 'Inactive' } }
    );

    const societies = await Society.find().lean();
    return sendSuccessResponse(res, 200, 'Societies fetched successfully.', { data: societies });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch societies'));
  }
};

const getSocietyById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return next(createHttpError('Society not found.', 404));
    }

    
    if (
      society.engagement &&
      society.engagement.endDate &&
      (society.status === 'Active' || society.status === 'Trial')
    ) {
      const now = new Date();
      if (new Date(society.engagement.endDate) < now) {
        society.status = 'Inactive';
        await society.save();
      }
    }

    return sendSuccessResponse(res, 200, 'Society fetched successfully.', { data: society });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch society'));
  }
};

const updateSocietyById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { engagement, societyAdmins, vehicleLimits, ...rest } = req.body;

    const updates = { ...rest };

    if (vehicleLimits) {
      updates.vehicleLimits = vehicleLimits;
    }

    if (engagement) {
      const totals = computeEngagementTotals(engagement);
      updates.engagement = {
        ...engagement,
        ...(totals.gst !== undefined ? { gst: totals.gst } : {}),
        ...(totals.total !== undefined ? { total: totals.total } : {}),
      };
    }

    if (Array.isArray(societyAdmins) && societyAdmins.length > 0) {
      const normalizedSocietyAdmins = normalizeIncomingAdmins(societyAdmins);
      await ensureAdminListIsUnique(normalizedSocietyAdmins, { skipDbCheck: true });
      updates.societyAdmins = normalizedSocietyAdmins;
    }

    const updatedSociety = await Society.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedSociety) {
      return next(createHttpError('Society not found.', 404));
    }

    
    try {
      const wings = Array.isArray(updatedSociety.structure) ? updatedSociety.structure : [];
      const officialKeys = new Set();
      wings.forEach((wing) => {
        const wingLower = (wing.wingName || '').toString().trim().toLowerCase();
        const units = Array.isArray(wing.units) ? wing.units : [];
        units.forEach((u) => {
          const unitLower = (u.unitNumber || '').toString().trim().toLowerCase();
          if (wingLower && unitLower) officialKeys.add(`${wingLower}:${unitLower}`);
        });
      });

      const pending = await MissingUnitRequest.find(
        { societyId: updatedSociety._id, status: 'pending' },
        { _id: 1, wingNameLower: 1, unitNumberLower: 1 }
      ).lean();

      const toDelete = pending
        .filter((d) => officialKeys.has(`${(d.wingNameLower || '').toString()}:${(d.unitNumberLower || '').toString()}`))
        .map((d) => d._id);

      if (toDelete.length > 0) {
        await MissingUnitRequest.deleteMany({ _id: { $in: toDelete } });
      }
    } catch (e) {
      
    }

    return sendSuccessResponse(res, 200, 'Society updated successfully.', { data: updatedSociety });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to update society'));
  }
};

const toggleSocietyStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return next(createHttpError('Society not found.', 404));
    }

    society.status = society.status === 'Active' ? 'Inactive' : 'Active';
    await society.save();

    return sendSuccessResponse(res, 200, `Society status updated to ${society.status}`, {
      data: society,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to toggle society status'));
  }
};

const suspendSociety = async (req, res, next) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return next(createHttpError('Society not found.', 404));
    }

    if (society.status === 'Suspended') {
      return next(createHttpError('Society is already suspended.', 400));
    }

    society.status = 'Suspended';
    await society.save();

    return sendSuccessResponse(res, 200, 'Society suspended successfully.', {
      data: society,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to suspend society'));
  }
};


module.exports = {
  createSociety,
  getAllSociety,
  getSocietyById,
  updateSocietyById,
  toggleSocietyStatus,
  suspendSociety,
};
