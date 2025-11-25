const RESERVED_KEYS = new Set(['statusCode', 'success', 'message', 'timestamp']);

const sanitizePayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (value === undefined || RESERVED_KEYS.has(key)) {
      return acc;
    }

    acc[key] = value;
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

