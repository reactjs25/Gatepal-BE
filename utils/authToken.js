const jwt = require('jsonwebtoken');

const USER_JWT_EXPIRES_IN = process.env.USER_JWT_EXPIRES_IN || '7d';

const generateUserAuthToken = ({ id, role, extraClaims = {} }) =>
  jwt.sign(
    {
      id,
      role,
      ...extraClaims,
    },
    process.env.JWT_SECRET,
    { expiresIn: USER_JWT_EXPIRES_IN }
  );

module.exports = {
  generateUserAuthToken,
};

