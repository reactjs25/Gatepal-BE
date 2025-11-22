const Society = require('../model/societySchema');
const { createHttpError } = require('../utils/httpError');
const { ensureAdminListIsUnique } = require('../utils/societyAdminUtils');

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
        email: admin.email ? admin.email.trim().toLowerCase() : admin.email,
        mobile: admin.mobile ? admin.mobile.trim() : admin.mobile,
      }))
    : [];

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
    } = req.body;

    const engagement = engagementInput || {};
    let gst = engagement.gst;
    let total = engagement.total;

    if (gst === undefined && engagement.baseRate !== undefined) {
      gst = engagement.baseRate * 0.18;
    }

    if (total === undefined && engagement.baseRate !== undefined) {
      total = engagement.baseRate + (gst !== undefined ? gst : 0);
    }
    const normalizedSocietyAdmins = Array.isArray(societyAdmins)
      ? normalizeIncomingAdmins(societyAdmins)
      : undefined;

    if (normalizedSocietyAdmins?.length > 0) {
      await ensureAdminListIsUnique(normalizedSocietyAdmins);
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
        gst,
        total,
      },
    });

    await newSociety.save();
    res.status(201).json({ message: 'Society created successfully', data: newSociety });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to create society';
    next(error);
  }
};

const getAllSociety = async (req, res, next) => {
  try {
    const societies = await Society.find();
    res.status(200).json({ message: 'Societies fetched successfully', data: societies });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch societies';
    next(error);
  }
};

const getSocietyById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    res.status(200).json({ message: 'Society fetched successfully', data: society });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch society';
    next(error);
  }
};

const updateSocietyById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { engagement, societyAdmins, ...rest } = req.body;

    const updates = { ...rest };

    if (engagement) {
      let gst = engagement.gst;
      let total = engagement.total;

      if (gst === undefined && engagement.baseRate !== undefined) {
        gst = engagement.baseRate * 0.18;
      }

      if (total === undefined && engagement.baseRate !== undefined) {
        total = engagement.baseRate + (gst !== undefined ? gst : 0);
      }

      updates.engagement = {
        ...engagement,
        ...(gst !== undefined ? { gst } : {}),
        ...(total !== undefined ? { total } : {}),
      };
    }

    if (Array.isArray(societyAdmins) && societyAdmins.length > 0) {
      const normalizedSocietyAdmins = normalizeIncomingAdmins(societyAdmins);
      await ensureAdminListIsUnique(normalizedSocietyAdmins, { excludeSocietyId: id });
      updates.societyAdmins = normalizedSocietyAdmins;
    }

    const updatedSociety = await Society.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedSociety) {
      return next(createHttpError('Society not found', 404));
    }

    res.status(200).json({ message: 'Society updated successfully', data: updatedSociety });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to update society';
    next(error);
  }
};

const toggleSocietyStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    society.status = society.status === 'Active' ? 'Inactive' : 'Active';
    await society.save();

    res.status(200).json({ message: `Society status updated to ${society.status}`, data: society });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to toggle society status';
    next(error);
  }
};


module.exports = {
  createSociety,
  getAllSociety,
  getSocietyById,
  updateSocietyById,
  toggleSocietyStatus,
};
