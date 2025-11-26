const RESERVED_KEYS = new Set(['statusCode', 'success', 'message', 'timestamp']);

const normalizeValue = (value) => {
  if (value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeValue(v));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [k, v]) => {
      if (v === undefined || RESERVED_KEYS.has(k)) {
        return acc;
      }
      acc[k] = normalizeValue(v);
      return acc;
    }, {});
  }
  return value;
};

const sanitizePayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (value === undefined || RESERVED_KEYS.has(key)) {
      return acc;
    }

    acc[key] = normalizeValue(value);
    return acc;
  }, {});
};

const sendSuccessResponse = (res, statusCode = 200, message = 'OK', payload = {}) => {
  const safeStatus = Number.isInteger(statusCode) ? statusCode : 200;
  const responseBody = {
    statusCode: safeStatus,
    success: true,
    message,
    timestamp: new Date().toISOString(),
    ...sanitizePayload(payload),
  };

  return res.status(safeStatus).json(responseBody);
};

module.exports = {
  sendSuccessResponse,
};

