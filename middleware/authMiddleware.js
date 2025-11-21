const jwt = require('jsonwebtoken');
const SuperAdmin = require('../model/superAdminSchema');
const { createHttpError } = require('../utils/httpError');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(createHttpError('Authorization token missing or invalid', 401));
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id || decoded.role !== 'super_admin') {
      return next(createHttpError('Access denied', 403));
    }

    const superAdmin = await SuperAdmin.findById(decoded.id).select('-password');

    if (!superAdmin) {
      return next(createHttpError('Unauthorized: user not found', 401));
    }

    req.user = {
      id: superAdmin._id,
      fullName: superAdmin.fullName,
      email: superAdmin.email,
      phoneNumber: superAdmin.phoneNumber,
      role: decoded.role,
    };

    next();
  } catch (error) {
    return next(createHttpError('Invalid or expired token', 401));
  }
};

module.exports = authMiddleware;
