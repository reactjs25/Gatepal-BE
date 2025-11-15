const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Society = require('../model/societySchema');
const { createTransporter, buildResetUrl } = require('../utils/passwordReset');

const SALT_ROUNDS = 10;
const RESET_LINK_EXPIRY_MS = 60 * 60 * 1000;

const createHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
};

const formatDate = (value) => {
  if (!value) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
};

const sanitizeSocietyAdmin = (society, admin) => ({
  _id: admin._id.toString(),
  id: admin._id.toString(),
  name: admin.name,
  email: admin.email,
  mobile: admin.mobile,
  status: admin.status,
  societyId: society._id.toString(),
  societyName: society.societyName,
  createdAt: formatDate(admin.createdAt),
  updatedAt: formatDate(admin.updatedAt),
});

const mapSocietyAdmins = (society) =>
  society.societyAdmins.map((admin) => sanitizeSocietyAdmin(society, admin));

const createSocietyAdmin = async (req, res, next) => {
  try {
    const { societyId } = req.params;
    const { name, email, mobile } = req.body;

    if (!name || !email || !mobile) {
      return next(
        createHttpError('Name, email, and mobile are required to create a society admin', 400)
      );
    }

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const normalizedEmail = email.trim().toLowerCase();

    const duplicateAdmin = society.societyAdmins.find(
      (admin) => admin.email?.toLowerCase() === normalizedEmail
    );

    if (duplicateAdmin) {
      return next(createHttpError('An admin with this email already exists', 409));
    }

    society.societyAdmins.push({ name, email: normalizedEmail, mobile: mobile.trim() });
    await society.save();

    const newAdmin = society.societyAdmins[society.societyAdmins.length - 1];
    const sanitizedAdmin = sanitizeSocietyAdmin(society, newAdmin);

    res.status(201).json({
      message: 'Society admin created successfully',
      data: {
        societyId: society._id.toString(),
        societyName: society.societyName,
        admin: sanitizedAdmin,
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to create society admin';
    next(error);
  }
};

const getAllSocietyAdmins = async (req, res, next) => {
  try {
    const { societyId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    res.status(200).json({
      message: 'Society admins fetched successfully',
      data: {
        societyId: society._id.toString(),
        societyName: society.societyName,
        admins: mapSocietyAdmins(society),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch society admins';
    next(error);
  }
};

const getSocietyAdminById = async (req, res, next) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return next(createHttpError('Society admin not found', 404));
    }

    res.status(200).json({
      message: 'Society admin fetched successfully',
      data: {
        societyId: society._id.toString(),
        societyName: society.societyName,
        admin: sanitizeSocietyAdmin(society, admin),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch society admin';
    next(error);
  }
};

const updateSocietyAdmin = async (req, res, next) => {
  try {
    const { societyId, adminId } = req.params;
    const { name, email, mobile } = req.body;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return next(createHttpError('Society admin not found', 404));
    }

    if (name !== undefined) admin.name = name;
    if (email !== undefined) admin.email = email.trim().toLowerCase();
    if (mobile !== undefined) admin.mobile = mobile.trim();

    await society.save();

    res.status(200).json({
      message: 'Society admin updated successfully',
      data: {
        societyId: society._id.toString(),
        societyName: society.societyName,
        admin: sanitizeSocietyAdmin(society, admin),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to update society admin';
    next(error);
  }
};

const toggleSocietyAdminStatus = async (req, res, next) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return next(createHttpError('Society admin not found', 404));
    }

    admin.status = admin.status === 'Active' ? 'Inactive' : 'Active';
    await society.save();

    res.status(200).json({
      message: `Society admin status updated to ${admin.status}`,
      data: {
        societyId: society._id.toString(),
        societyName: society.societyName,
        admin: sanitizeSocietyAdmin(society, admin),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to toggle society admin status';
    next(error);
  }
};

const deleteSocietyAdmin = async (req, res, next) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return next(createHttpError('Society admin not found', 404));
    }

    admin.deleteOne();
    await society.save();

    res.status(200).json({ message: 'Society admin deleted successfully' });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to delete society admin';
    next(error);
  }
};

const requestSocietyAdminPasswordReset = async (req, res, next) => {
  try {
    const { societyId, adminId } = req.params;

    const society = await Society.findById(societyId);

    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const admin = society.societyAdmins.id(adminId);

    if (!admin) {
      return next(createHttpError('Society admin not found', 404));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    admin.resetPasswordToken = hashedToken;
    admin.resetPasswordExpires = new Date(Date.now() + RESET_LINK_EXPIRY_MS);

    await society.save();

    const transporter = createTransporter();
    const baseUrl = process.env.SOCIETY_ADMIN_PASSWORD_RESET_URL;
    const resetUrl = buildResetUrl(resetToken, admin.email, {
      baseUrl,
      fallbackPath: '/reset-password',
      envKey: 'SOCIETY_ADMIN_PASSWORD_RESET_URL',
      extraParams: { role: 'society_admin' },
    });
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from: fromAddress,
      to: admin.email,
      subject: 'Gatepal | Reset your society admin password',
      text: `You requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
      html: `<p>You requested a password reset for your Gatepal society admin account.</p>
             <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
             <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
             <p>If you did not request this, please ignore this email.</p>`,
    });

    return res.status(200).json({
      message: 'Password reset link sent successfully',
      data: {
        societyId: society._id.toString(),
        admin: sanitizeSocietyAdmin(society, admin),
      },
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to send password reset email';
    return next(error);
  }
};

const resetSocietyAdminPassword = async (req, res, next) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return next(createHttpError('Token, email, and password are required', 400));
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const normalizedEmail = email.trim().toLowerCase();

    const society = await Society.findOne({
      'societyAdmins.email': normalizedEmail,
      'societyAdmins.resetPasswordToken': hashedToken,
      'societyAdmins.resetPasswordExpires': { $gt: new Date() },
    });

    if (!society) {
      return next(createHttpError('Invalid or expired reset token', 400));
    }

    const admin = society.societyAdmins.find(
      (candidate) =>
        candidate.email?.toLowerCase() === normalizedEmail &&
        candidate.resetPasswordToken === hashedToken &&
        candidate.resetPasswordExpires &&
        candidate.resetPasswordExpires > new Date()
    );

    if (!admin) {
      return next(createHttpError('Invalid or expired reset token', 400));
    }

    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    admin.password = await bcrypt.hash(password, salt);
    admin.resetPasswordToken = null;
    admin.resetPasswordExpires = null;

    await society.save();

    return res.status(200).json({
      message: 'Password reset successful',
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to reset password';
    return next(error);
  }
};

module.exports = {
  createSocietyAdmin,
  getAllSocietyAdmins,
  getSocietyAdminById,
  updateSocietyAdmin,
  toggleSocietyAdminStatus,
  deleteSocietyAdmin,
  requestSocietyAdminPasswordReset,
  resetSocietyAdminPassword,
};
