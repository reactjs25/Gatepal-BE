const ErrorLog = require('../model/errorLogSchema');

const SENSITIVE_FIELDS = ['password', 'confirmPassword', 'token', 'authorization', 'refreshToken'];

const redactValue = (value) => {
  if (typeof value === 'string') {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map(() => '[REDACTED]');
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = redactValue(value[key]);
      return acc;
    }, {});
  }

  return undefined;
};

const sanitizeObject = (source) => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  return Object.keys(source).reduce((acc, key) => {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      acc[key] = redactValue(source[key]);
      return acc;
    }

    acc[key] = source[key];
    return acc;
  }, {});
};

const buildLogPayload = ({ req, error, statusCode, tags, context, apiEndpoint, method }) => {
  const safeBody = req ? sanitizeObject(req.body) : undefined;
  const safeQuery = req ? sanitizeObject(req.query) : undefined;
  const safeParams = req ? sanitizeObject(req.params) : undefined;
  const safeHeaders = req
    ? sanitizeObject(
        Object.keys(req.headers || {}).reduce((acc, key) => {
          if (key.toLowerCase() === 'authorization') {
            acc[key] = redactValue(req.headers[key]);
          } else {
            acc[key] = req.headers[key];
          }
          return acc;
        }, {})
      )
    : undefined;

  const endpoint = apiEndpoint || (req ? req.originalUrl || req.url : 'N/A');

  return {
    apiEndpoint: endpoint,
    method: method || (req ? req.method : 'N/A'),
    statusCode,
    errorMessage: error?.message || 'Unknown error',
    errorStack: error?.stack,
    requestBody: safeBody,
    requestQuery: safeQuery,
    requestParams: safeParams,
    headers: safeHeaders,
    userContext: context,
    tags,
  };
};

const logError = async (options) => {
  try {
    const payload = buildLogPayload(options);
    await ErrorLog.create(payload);
  } catch (logError) {
    console.error('Failed to persist error log:', logError);
  }
};

module.exports = {
  logError,
  buildLogPayload,
};

