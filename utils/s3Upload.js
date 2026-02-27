const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

const normalizeObjectKey = (value) =>
  String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

const uploadBufferToS3ByKey = async ({ buffer, contentType, key, cacheControl, contentDisposition }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload buffer is empty or invalid.');
  }

  const normalizedKey = normalizeObjectKey(key);
  if (!normalizedKey) {
    throw new Error('S3 object key is required.');
  }

  const client = getS3Client();
  const bucket = config.aws.s3Bucket;
  const region = config.aws.region;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: normalizedKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: cacheControl || undefined,
      ContentDisposition: contentDisposition || undefined,
    })
  );

  return buildPublicUrl({ bucket, region, key: normalizedKey });
};

const uploadBufferToS3 = async ({ buffer, contentType, keyPrefix, fileExtension = 'bin', fileName }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload buffer is empty or invalid.');
  }

  const prefix = sanitizePathPart(keyPrefix || 'uploads');
  const safeName = sanitizePathPart(fileName || crypto.randomUUID());
  const ext = String(fileExtension || 'bin').replace(/^\./, '').toLowerCase();
  const key = `${prefix}/${safeName}.${ext}`;
  return uploadBufferToS3ByKey({
    buffer,
    contentType,
    key,
  });
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

module.exports = {
  isS3Configured,
  uploadBufferToS3,
  uploadBufferToS3ByKey,
  uploadImageDataUrlToS3,
  decodeBase64ImageDataUrl,
  getS3ObjectKeyFromUrl,
};
