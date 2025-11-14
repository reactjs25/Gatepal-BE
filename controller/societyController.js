const Society = require('../model/societySchema');

const createSociety = async (req, res) => {
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
      engagement,
    } = req.body;

    let gst = engagement.gst || engagement.baseRate * 0.18;
    let total = engagement.total || engagement.baseRate + gst;

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
    console.error(error);
    res.status(500).json({ message: 'Failed to create society', error: error.message });
  }
};

const getAllSociety = async (req, res) => {
  try {
    const societies = await Society.find();
    res.status(200).json({ message: 'Societies fetched successfully', data: societies });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch societies', error: error.message });
  }
};

const getSocietyById = async (req, res) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    res.status(200).json({ message: 'Society fetched successfully', data: society });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch society', error: error.message });
  }
};

const updateSocietyById = async (req, res) => {
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
      return res.status(404).json({ message: 'Society not found' });
    }

    res.status(200).json({ message: 'Society updated successfully', data: updatedSociety });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update society', error: error.message });
  }
};

const toggleSocietyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const society = await Society.findById(id);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    society.status = society.status === 'Active' ? 'Inactive' : 'Active';
    await society.save();

    res.status(200).json({ message: `Society status updated to ${society.status}`, data: society });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to toggle society status', error: error.message });
  }
};


module.exports = {
  createSociety,
  getAllSociety,
  getSocietyById,
  updateSocietyById,
  toggleSocietyStatus,
};
