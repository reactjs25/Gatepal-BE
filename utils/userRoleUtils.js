const { createHttpError } = require('./httpError');

const ROLE_TYPES = {
  MEMBER: 'member',
  VISITOR: 'visitor',
  GUARD: 'guard',
  SOCIETY_ADMIN: 'society_admin',
};

const APP_USER_ROLES = new Set([
  ROLE_TYPES.MEMBER,
  ROLE_TYPES.VISITOR,
  ROLE_TYPES.GUARD,
  ROLE_TYPES.SOCIETY_ADMIN,
]);

const sanitizeRoleInput = (rawRole = '') =>
  rawRole
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const normalizeRole = (rawRole = '') => {
  const sanitized = sanitizeRoleInput(rawRole);

  if (!sanitized) {
    throw createHttpError('Role is required', 400);
  }

  if (sanitized === 'security_guard') {
    return ROLE_TYPES.GUARD;
  }

  if (sanitized === ROLE_TYPES.SOCIETY_ADMIN) {
    return ROLE_TYPES.SOCIETY_ADMIN;
  }

  if (APP_USER_ROLES.has(sanitized)) {
    return sanitized;
  }

  throw createHttpError('Unsupported role provided', 400);
};

const resolveOnboardingFlow = (role) => {
  switch (role) {
    case ROLE_TYPES.SOCIETY_ADMIN:
    case ROLE_TYPES.MEMBER:
      return 'member';
    case ROLE_TYPES.GUARD:
      return 'guard';
    case ROLE_TYPES.VISITOR:
      return 'visitor';
    default:
      return 'member';
  }
};

module.exports = {
  ROLE_TYPES,
  APP_USER_ROLES,
  normalizeRole,
  resolveOnboardingFlow,
};

