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

module.exports = {
  ensureBase64ImageDataUrl,
};
