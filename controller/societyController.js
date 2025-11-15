const Society = require('../model/societySchema');

const createHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
};

const createSociety = async (req, res, next) => {
  try {
    const {
      societyName,
      societyPin,
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

    const newSociety = new Society({
      societyName,
      societyPin,
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
    const { engagement, ...rest } = req.body;

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
