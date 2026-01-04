const normalizeString = (value) => (value || '').toString().trim();

const toTitleCaseName = (value) => {
  const s = normalizeString(value);
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

module.exports = {
  normalizeString,
  toTitleCaseName,
};

