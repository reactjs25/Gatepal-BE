const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config/appConfig');

let s3Client = null;

const isS3Configured = () => {
  const aws = config.aws || {};
  return Boolean(aws.region && aws.accessKeyId && aws.secretAccessKey && aws.s3Bucket);
};

const getS3Client = () => {
  if (!isS3Configured()) {
    throw new Error('AWS S3 is not configured. Please set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_S3_BUCKET.');
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }

  return s3Client;
};

const sanitizePathPart = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');

const buildPublicUrl = ({ bucket, region, key }) =>
  `https://${bucket}.s3.${region}.amazonaws.com/${encodeURI(key)}`;

const getSignedReadUrlTtlSeconds = () => {
  const raw = Number(config?.aws?.s3SignedUrlTtlSeconds);
  if (!Number.isFinite(raw)) return 900;
  if (raw < 60) return 60;
  if (raw > 7 * 24 * 60 * 60) return 7 * 24 * 60 * 60;
  return Math.round(raw);
};

const getS3ObjectKeyFromUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const bucket = String(config?.aws?.s3Bucket || '').trim();
  if (!bucket) return null;
  const bucketLower = bucket.toLowerCase();

  const s3Match = trimmed.match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (s3Match) {
    const matchedBucket = String(s3Match[1] || '').toLowerCase();
    const key = decodeURIComponent(String(s3Match[2] || '').replace(/^\/+/, ''));
    if (!key) return null;
    return matchedBucket === bucketLower ? key : null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    return null;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  const path = decodeURIComponent(String(parsed.pathname || '').replace(/^\/+/, ''));
  if (!path) return null;

  if (host === `${bucketLower}.s3.amazonaws.com` || host.startsWith(`${bucketLower}.s3.`)) {
    return path;
  }

  if (host === 's3.amazonaws.com' || host.startsWith('s3.')) {
    const pathLower = path.toLowerCase();
    const bucketPrefix = `${bucketLower}/`;
    if (pathLower.startsWith(bucketPrefix)) {
      return path.substring(bucketPrefix.length);
    }
  }

  return null;
};

const uploadBufferToS3 = async ({ buffer, contentType, keyPrefix, fileExtension = 'bin', fileName }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload buffer is empty or invalid.');
  }

  const client = getS3Client();
  const bucket = config.aws.s3Bucket;
  const region = config.aws.region;

  const prefix = sanitizePathPart(keyPrefix || 'uploads');
  const safeName = sanitizePathPart(fileName || crypto.randomUUID());
  const ext = String(fileExtension || 'bin').replace(/^\./, '').toLowerCase();
  const key = `${prefix}/${safeName}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  return buildPublicUrl({ bucket, region, key });
};

const decodeBase64ImageDataUrl = (value, fieldLabel = 'Image') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required.`);
  }

  const match = trimmed.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) {
    throw new Error(`${fieldLabel} must be a base64 encoded image data URL.`);
  }

  const mimeSubtype = String(match[1] || 'png').toLowerCase();
  const payload = String(match[2] || '').replace(/\s+/g, '');
  if (!payload) {
    throw new Error(`${fieldLabel} payload is empty.`);
  }

  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch (error) {
    throw new Error(`${fieldLabel} payload is not valid base64.`);
  }

  if (!buffer || buffer.length === 0) {
    throw new Error(`${fieldLabel} payload is not valid base64.`);
  }

  const normalizedSubtype = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;

  return {
    buffer,
    mimeType: `image/${mimeSubtype}`,
    fileExtension: normalizedSubtype,
  };
};

const uploadImageDataUrlToS3 = async ({ dataUrl, keyPrefix, fileName, fieldLabel = 'Image' }) => {
  const { buffer, mimeType, fileExtension } = decodeBase64ImageDataUrl(dataUrl, fieldLabel);
  return uploadBufferToS3({
    buffer,
    contentType: mimeType,
    keyPrefix,
    fileExtension,
    fileName,
  });
};

const getSignedReadUrlForStoredObject = async (value, options = {}) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!isS3Configured()) return trimmed;

  const key = getS3ObjectKeyFromUrl(trimmed);
  if (!key) return trimmed;

  const expiresIn = Number.isFinite(Number(options.expiresIn))
    ? Number(options.expiresIn)
    : getSignedReadUrlTtlSeconds();

  try {
    const client = getS3Client();
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: key,
      }),
      { expiresIn }
    );
  } catch (error) {
    return trimmed;
  }
};

const signS3UrlsInObject = async (value, options = {}) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    const key = getS3ObjectKeyFromUrl(value);
    if (!key) return value;
    return getSignedReadUrlForStoredObject(value, options);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => signS3UrlsInObject(item, options)));
  }

  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value;
    }

    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = await signS3UrlsInObject(item, options);
    }
    return output;
  }

  return value;
};

module.exports = {
  isS3Configured,
  uploadBufferToS3,
  uploadImageDataUrlToS3,
  decodeBase64ImageDataUrl,
  getS3ObjectKeyFromUrl,
  getSignedReadUrlForStoredObject,
  signS3UrlsInObject,
};
