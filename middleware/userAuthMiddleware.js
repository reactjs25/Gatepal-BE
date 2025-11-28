const jwt = require('jsonwebtoken');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const { normalizeDigits } = require('../utils/phoneNumber');
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
    
    if (decoded.role === 'society_admin') {
      const societyId = decoded.societyId;
      if (!societyId) {
        return next(createHttpError('Unauthorized: society context missing', 401));
      }

      const society = await Society.findById(societyId);
      if (!society) {
        return next(createHttpError('Unauthorized: society not found', 401));
      }

      const admin = society.societyAdmins.id(decoded.id);
      if (!admin) {
        return next(createHttpError('Unauthorized: admin not found', 401));
      }

      const digits = normalizeDigits(admin.mobile || '');
      const linkedUser = await User.findOne({
        $or: [
          { linkedSocietyAdminId: admin._id },
          { phoneNumber: digits },
        ],
      });

      if (!linkedUser) {
        return next(createHttpError('Unauthorized: user not found', 401));
      }

      req.user = {
        id: linkedUser._id,
        role: linkedUser.role,
        phoneNumber: linkedUser.phoneNumber,
        effectiveRole: 'society_admin',
        scope: 'app_user',
      };
      req.appUser = linkedUser;
      return next();
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

