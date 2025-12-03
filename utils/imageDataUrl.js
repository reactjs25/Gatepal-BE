const SUPPORTED_IMAGE_MIME_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp']);

const ensureBase64ImageDataUrl = ({ value, fieldLabel, minBytes = 1024, allowedMimeTypes }) => {
  const mimeSet = allowedMimeTypes && Array.isArray(allowedMimeTypes)
    ? new Set(allowedMimeTypes.map((m) => String(m).toLowerCase()))
    : SUPPORTED_IMAGE_MIME_TYPES;

  const trimmed = (value || '').toString().trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required to continue onboarding`);
  }

  const match = trimmed.match(/^data:image\/([a-z+]+);base64,/i);
  if (!match) {
    throw new Error(`${fieldLabel} must be a base64 encoded image data URL`);
  }

  const mime = (match[1] || '').toLowerCase();
  if (!mimeSet.has(mime)) {
    throw new Error(`${fieldLabel} must be PNG, JPG, JPEG, or WEBP`);
  }

  const payload = trimmed.substring(trimmed.indexOf(',') + 1).replace(/\s+/g, '');
  if (!payload) {
    throw new Error(`${fieldLabel} payload is empty`);
  }

  let buf;
  try {
    buf = Buffer.from(payload, 'base64');
  } catch (e) {
    throw new Error(`${fieldLabel} payload is not valid base64 data`);
  }

  if (!buf || buf.length < minBytes) {
    throw new Error(`${fieldLabel} appears invalid or too small`);
  }

  return trimmed;
};

module.exports = {
  ensureBase64ImageDataUrl,
};

