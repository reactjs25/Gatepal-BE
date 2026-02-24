const { signS3UrlsInObject } = require('./s3Upload');

const RESERVED_KEYS = new Set(['statusCode', 'success', 'message', 'timestamp']);

const isPlainObject = (obj) => {
  if (!obj || typeof obj !== 'object') return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
};

const normalizeValue = (value) => {
  if (value === null) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((v) => normalizeValue(v));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value.toHexString();
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
      return value.toString('base64');
    }

    if (typeof value.toJSON === 'function' && !isPlainObject(value)) {
      return normalizeValue(value.toJSON());
    }

    if (!isPlainObject(value)) {
      return value;
    }

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
  const sanitized = sanitizePayload(payload);

  const isEmptyData = (val) => {
    if (val === null || val === undefined) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val).length === 0;
    return false;
  };

  const formatDataField = (val) => {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.map((item) => formatDataField(item));
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'object') {
      if (typeof val.toHexString === 'function') {
        return val.toHexString();
      }

      if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(val)) {
        return val.toString('base64');
      }

      if (typeof val.toJSON === 'function' && !isPlainObject(val)) {
        return formatDataField(val.toJSON());
      }

      const out = {};
      for (const [k, v] of Object.entries(val)) {
        if (v === null || v === undefined) {
          out[k] = '';
        } else {
          out[k] = formatDataField(v);
        }
      }
      return out;
    }
    return val;
  };

  const hasDataKey = Object.prototype.hasOwnProperty.call(payload || {}, 'data');

  const buildResponseBody = async () => {
    if (hasDataKey) {
      const formattedData = isEmptyData(payload.data) ? null : formatDataField(payload.data);
      sanitized.data = formattedData === null ? null : await signS3UrlsInObject(formattedData);
    }

    return {
      statusCode: safeStatus,
      success: true,
      message,
      timestamp: new Date().toISOString(),
      ...sanitized,
    };
  };

  const buildFallbackResponseBody = () => {
    if (hasDataKey) {
      sanitized.data = isEmptyData(payload.data) ? null : formatDataField(payload.data);
    }

    return {
      statusCode: safeStatus,
      success: true,
      message,
      timestamp: new Date().toISOString(),
      ...sanitized,
    };
  };

  return Promise.resolve()
    .then(buildResponseBody)
    .then((responseBody) => res.status(safeStatus).json(responseBody))
    .catch(() => {
      if (res.headersSent) return res;
      const responseBody = buildFallbackResponseBody();
      return res.status(safeStatus).json(responseBody);
    });
};

module.exports = {
  sendSuccessResponse,
};

