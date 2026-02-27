const { uploadImageDataUrlToS3 } = require('./s3Upload');

const ensureBase64ImageDataUrl = ({ value, fieldLabel }) => {
  const trimmed = (value || '').toString().trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required to continue onboarding`);
  }

  const match = trimmed.match(/^data:image\/([a-z0-9.+-]+);base64,/i);
  if (!match) {
    throw new Error(`${fieldLabel} must be a base64 encoded image data URL`);
  }

  const payload = trimmed.substring(trimmed.indexOf(',') + 1).replace(/\s+/g, '');
  if (!payload) {
    throw new Error(`${fieldLabel} payload is empty`);
  }

  try {
    Buffer.from(payload, 'base64');
  } catch (e) {
    throw new Error(`${fieldLabel} payload is not valid base64 data`);
  }

  return trimmed;
};

const isHttpUrl = (value) => /^https?:\/\//i.test((value || '').toString().trim());

const normalizeImageInputToStorageUrl = async ({ value, fieldLabel, keyPrefix, fileName }) => {
  const trimmed = (value || '').toString().trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required to continue onboarding`);
  }

  if (isHttpUrl(trimmed)) {
    return trimmed;
  }

  const dataUrl = ensureBase64ImageDataUrl({ value: trimmed, fieldLabel });
  return uploadImageDataUrlToS3({
    dataUrl,
    keyPrefix,
    fileName,
    fieldLabel,
  });
};

const normalizeImageListToStorageUrls = async ({ values, fieldLabel, keyPrefix, fileNamePrefix = 'image' }) => {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const now = Date.now();
  return Promise.all(
    values.map((value, index) =>
      normalizeImageInputToStorageUrl({
        value,
        fieldLabel,
        keyPrefix,
        fileName: `${fileNamePrefix}-${index + 1}-${now}`,
      })
    )
  );
};

module.exports = {
  ensureBase64ImageDataUrl,
  normalizeImageInputToStorageUrl,
  normalizeImageListToStorageUrls,
};
