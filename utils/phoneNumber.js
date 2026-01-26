const normalizePhoneNumber = (value = '') => value.trim().replace(/\s+/g, '');

const normalizeCountryCode = (value) => {
  if (!value) {
    return '+91';
  }

  const trimmed = value.trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
};

const normalizeDigits = (value = '') => value.replace(/\D/g, '');

const normalizePhoneDigits = (value = '') => {
  const digits = normalizeDigits(value);
  

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  
 
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  
  return digits;
};

const isTenDigitPhone = (value = '') => {
  const digits = normalizePhoneDigits(value);
  return digits.length === 10;
};

const getComparablePhoneNumber = ({ countryCode, phoneNumber }) => {
  const digits = normalizeDigits(phoneNumber);
  const normalizedCode = normalizeCountryCode(countryCode).replace(/\D/g, '');
  return `${normalizedCode}${digits}`;
};

module.exports = {
  normalizePhoneNumber,
  normalizeCountryCode,
  normalizeDigits,
  normalizePhoneDigits,
  getComparablePhoneNumber,
  isTenDigitPhone,
};

