const Society = require('../model/societySchema');

const createSocietyAdmin = async (req, res) => {
  try {
    const { societyId } = req.params;
    const { name, email, mobile } = req.body;

    if (!name || !email || !mobile) {
      return res
        .status(400)
        .json({ message: 'Name, email, and mobile are required to create a society admin' });
    }

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    const duplicateAdmin = society.societyAdmins.find(
      (admin) => admin.email.toLowerCase() === email.toLowerCase()
    );

    if (duplicateAdmin) {
      return res.status(409).json({ message: 'An admin with this email already exists' });
    }

    society.societyAdmins.push({ name, email, mobile });
    await society.save();

    const newAdmin = society.societyAdmins[society.societyAdmins.length - 1];

    res.status(201).json({
      message: 'Society admin created successfully',
      data: {
        societyId: society._id,
        societyName: society.societyName,
        admin: newAdmin,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to create society admin', error: error.message });
  }
};

const getAllSocietyAdmins = async (req, res) => {
  try {
    const { societyId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    res.status(200).json({
      message: 'Society admins fetched successfully',
      data: {
        societyId: society._id,
        societyName: society.societyName,
        admins: society.societyAdmins,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch society admins', error: error.message });
  }
};

const getSocietyAdminById = async (req, res) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return res.status(404).json({ message: 'Society admin not found' });
    }

    res.status(200).json({
      message: 'Society admin fetched successfully',
      data: {
        societyId: society._id,
        societyName: society.societyName,
        admin,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch society admin', error: error.message });
  }
};

const updateSocietyAdmin = async (req, res) => {
  try {
    const { societyId, adminId } = req.params;
    const { name, email, mobile } = req.body;

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return res.status(404).json({ message: 'Society admin not found' });
    }

    if (name !== undefined) admin.name = name;
    if (email !== undefined) admin.email = email;
    if (mobile !== undefined) admin.mobile = mobile;

    await society.save();

    res.status(200).json({
      message: 'Society admin updated successfully',
      data: {
        societyId: society._id,
        societyName: society.societyName,
        admin,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update society admin', error: error.message });
  }
};

const toggleSocietyAdminStatus = async (req, res) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return res.status(404).json({ message: 'Society admin not found' });
    }

    admin.status = admin.status === 'Active' ? 'Inactive' : 'Active';
    await society.save();

    res.status(200).json({
      message: `Society admin status updated to ${admin.status}`,
      data: {
        societyId: society._id,
        societyName: society.societyName,
        admin,
      },
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: 'Failed to toggle society admin status', error: error.message });
  }
};

const deleteSocietyAdmin = async (req, res) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return res.status(404).json({ message: 'Society not found' });
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return res.status(404).json({ message: 'Society admin not found' });
    }

    admin.deleteOne();
    await society.save();

    res.status(200).json({ message: 'Society admin deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete society admin', error: error.message });
  }
};

module.exports = {
  createSocietyAdmin,
  getAllSocietyAdmins,
  getSocietyAdminById,
  updateSocietyAdmin,
  toggleSocietyAdminStatus,
  deleteSocietyAdmin,
};
