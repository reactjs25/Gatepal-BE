const { createHttpError } = require('./httpError');

const ACCESSIBLE_SOCIETY_STATUSES = new Set(['Active', 'Trial']);

const isSocietyAccessible = (society) =>
  Boolean(society && ACCESSIBLE_SOCIETY_STATUSES.has(society.status));

const getSocietyAccessError = (society, options = {}) => {
  if (!society) {
    return createHttpError('Society not found.', 404);
  }

  const societyName = society.societyName || 'This society';

  if (society.status === 'Suspended') {
    return createHttpError(
      options.suspendedMessage || `${societyName} is suspended. Please contact support.`,
      403
    );
  }

  return createHttpError(
    options.inactiveMessage || `${societyName} is inactive. Please renew the contract to continue.`,
    403
  );
};

const assertSocietyIsAccessible = (society, options = {}) => {
  if (isSocietyAccessible(society)) {
    return society;
  }

  throw getSocietyAccessError(society, options);
};

module.exports = {
  ACCESSIBLE_SOCIETY_STATUSES,
  isSocietyAccessible,
  getSocietyAccessError,
  assertSocietyIsAccessible,
};