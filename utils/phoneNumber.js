const normalizePhoneNumber = (value = '') => value.trim().replace(/\s+/g, '');

const normalizeCountryCode = (value) => {
  if (!value) {
    return '+91';
  }

  const trimmed = value.trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
};

const normalizeDigits = (value = '') => value.replace(/\D/g, '');

const getComparablePhoneNumber = ({ countryCode, phoneNumber }) => {
  const digits = normalizeDigits(phoneNumber);
  const normalizedCode = normalizeCountryCode(countryCode).replace(/\D/g, '');
  return `${normalizedCode}${digits}`;
};

module.exports = {
  normalizePhoneNumber,
  normalizeCountryCode,
  normalizeDigits,
  getComparablePhoneNumber,
};

