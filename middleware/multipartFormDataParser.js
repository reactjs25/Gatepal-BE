const multer = require('multer');
const { createHttpError } = require('../utils/httpError');
const { uploadBufferToS3 } = require('../utils/s3Upload');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(['application/pdf']);

const isAllowedMultipartMimeType = (mimeType) => {
  const normalized = String(mimeType || '').toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.startsWith('image/')) return true;
  return ALLOWED_MIME_TYPES.has(normalized);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 20,
  },
  fileFilter: (req, file, cb) => {
    if (!file || !isAllowedMultipartMimeType(file.mimetype)) {
      return cb(createHttpError('Only image or PDF files are allowed in multipart uploads.', 400));
    }
    return cb(null, true);
  },
});

const normalizeFieldName = (fieldName) => {
  const raw = (fieldName || '').toString().trim();
  if (!raw) return '';
  if (raw.endsWith('[]')) {
    return raw.slice(0, -2);
  }
  return raw;
};

const pushBodyValue = (body, field, value) => {
  if (!field) return;
  const existing = body[field];

  if (existing === undefined) {
    body[field] = value;
    return;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
    body[field] = existing;
    return;
  }

  body[field] = [existing, value];
};

const sanitizePathPart = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');

const resolveExtensionFromMimeType = (mimeType, fallback = 'bin') => {
  const normalized = String(mimeType || '').toLowerCase().trim();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'application/pdf') return 'pdf';

  const slashIndex = normalized.indexOf('/');
  if (slashIndex !== -1 && slashIndex < normalized.length - 1) {
    return normalized.substring(slashIndex + 1).replace(/[^a-z0-9.+-]/g, '') || fallback;
  }

  return fallback;
};

const buildKeyPrefix = (req, field) => {
  const routePath = sanitizePathPart(req.originalUrl || req.path || 'multipart');
  const userId = sanitizePathPart(req?.appUser?._id || req?.user?.id || 'anonymous');
  const safeField = sanitizePathPart(field || 'image');

  return `multipart/${userId}/${routePath}/${safeField}`;
};

const buildFileName = (file, index) => {
  const baseName = sanitizePathPart((file && file.originalname) || `file-${index + 1}`) || `file-${index + 1}`;
  return `${baseName}-${Date.now()}-${index + 1}`;
};

const mapMultipartFilesToBody = async (req) => {
  if (!req || !Array.isArray(req.files) || req.files.length === 0) return;

  req.body = req.body || {};

  for (let index = 0; index < req.files.length; index += 1) {
    const file = req.files[index];
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      continue;
    }

    const field = normalizeFieldName(file.fieldname);
    if (!field) continue;

    const mimeType = String(file.mimetype || 'image/png').toLowerCase();
    const fileExtension = resolveExtensionFromMimeType(mimeType, 'jpg');
    const keyPrefix = buildKeyPrefix(req, field);
    const fileName = buildFileName(file, index);

    let uploadedUrl;
    try {
      uploadedUrl = await uploadBufferToS3({
        buffer: file.buffer,
        contentType: mimeType,
        keyPrefix,
        fileExtension,
        fileName,
      });
    } catch (error) {
      throw createHttpError(error.message || 'Failed to upload multipart file.', 500);
    }

    pushBodyValue(req.body, field, uploadedUrl);
  }
};

const multipartFormDataParser = (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  return upload.any()(req, res, (error) => {
    if (error) {
      if (error && error.code === 'LIMIT_FILE_SIZE') {
        return next(createHttpError('File size must be 10MB or less.', 400));
      }
      if (error && error.code === 'LIMIT_FILE_COUNT') {
        return next(createHttpError('Too many files uploaded in a single request.', 400));
      }
      return next(createHttpError(error.message || 'Invalid multipart upload payload.', 400));
    }

    Promise.resolve(mapMultipartFilesToBody(req))
      .then(() => next())
      .catch((uploadError) => next(uploadError));
  });
};

module.exports = multipartFormDataParser;
