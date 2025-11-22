const jwt = require('jsonwebtoken');
const User = require('../model/userSchema');
const { createHttpError } = require('../utils/httpError');

const userAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(createHttpError('Authorization token missing or invalid', 401));
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id) {
      return next(createHttpError('Access denied', 403));
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      return next(createHttpError('Unauthorized: user not found', 401));
    }

    req.user = {
      id: user._id,
      role: user.role,
      phoneNumber: user.phoneNumber,
      scope: 'app_user',
    };
    req.appUser = user;
    return next();
  } catch (error) {
    return next(createHttpError('Invalid or expired token', 401));
  }
};

module.exports = userAuthMiddleware;

