const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const SuperAdmin = require('../model/superAdminSchema');
const { createTransporter, buildResetUrl } = require('../utils/passwordReset');

const createHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
};

const generateToken = (superAdminId, email) =>
  jwt.sign(
    { id: superAdminId, email, role: 'super_admin' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const mapSuperAdminResponse = (superAdmin) => ({
  id: superAdmin._id,
  name: superAdmin.fullName,
  fullName: superAdmin.fullName,
  email: superAdmin.email,
  phoneNumber: superAdmin.phoneNumber,
  role: 'super_admin',
});

const signUp = async (req, res, next) => {
  try {
    const { fullName, email, password, phoneNumber } = req.body;

    if (!fullName || !email || !password || !phoneNumber) {
      return next(createHttpError('All fields are required', 400));
    }

    const existingSuperAdmin = await SuperAdmin.findOne({ email: email.toLowerCase() });

    if (existingSuperAdmin) {
      return next(createHttpError('A super admin with this email already exists', 409));
    }

    const superAdmin = new SuperAdmin({
      fullName,
      email,
      password,
      phoneNumber,
    });

    await superAdmin.save();

    const token = generateToken(superAdmin._id, superAdmin.email);

    return res.status(201).json({
      message: 'Super admin created successfully',
      data: mapSuperAdminResponse(superAdmin),
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to create super admin';
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(createHttpError('Email and password are required', 400));
    }

    const superAdmin = await SuperAdmin.findOne({ email: email.toLowerCase() });

    if (!superAdmin) {
      return next(createHttpError('Invalid email or password', 401));
    }

    const isPasswordValid = await superAdmin.comparePassword(password);

    if (!isPasswordValid) {
      return next(createHttpError('Invalid email or password', 401));
    }

    const token = generateToken(superAdmin._id, superAdmin.email);

    return res.status(200).json({
      message: 'Super admin login successful',
      data: mapSuperAdminResponse(superAdmin),
      token,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to login';
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(createHttpError('Email is required', 400));
    }

    const superAdmin = await SuperAdmin.findOne({ email: email.toLowerCase() });

    if (!superAdmin) {
      return next(createHttpError('No account found with this email address', 404));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    superAdmin.resetPasswordToken = hashedToken;
    superAdmin.resetPasswordExpires = Date.now() + 60 * 60 * 1000;

    await superAdmin.save();

    const transporter = createTransporter();
    const resetUrl = buildResetUrl(resetToken, superAdmin.email);
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from: fromAddress,
      to: superAdmin.email,
      subject: 'Gatepal | Reset your password',
      text: `You requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
      html: `<p>You requested a password reset for your Gatepal account.</p>
             <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
             <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
             <p>If you did not request this, please ignore this email.</p>`,
    });

    return res.status(200).json({
      message: 'If the email exists, a password reset link has been sent',
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to send password reset email';
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return next(createHttpError('Token, email, and password are required', 400));
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const superAdmin = await SuperAdmin.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!superAdmin) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    superAdmin.password = password;
    superAdmin.resetPasswordToken = null;
    superAdmin.resetPasswordExpires = null;

    await superAdmin.save();

    const authToken = generateToken(superAdmin._id, superAdmin.email);

    return res.status(200).json({
      message: 'Password reset successful',
      data: mapSuperAdminResponse(superAdmin),
      token: authToken,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to reset password';
    return next(error);
  }
};

module.exports = { signUp, login, forgotPassword, resetPassword };
