const SUPPORTED_LANGUAGE_CODES = Object.freeze([
  'en',
  'hi',
  'gu',
]);

const LANGUAGE_CODE_ALIASES = Object.freeze({
  hn: 'hi',
});

const normalizeSupportedLanguageCode = (languageCode) => {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const canonicalCode = LANGUAGE_CODE_ALIASES[normalized] || normalized;
  return SUPPORTED_LANGUAGE_CODES.includes(canonicalCode) ? canonicalCode : null;
};

const isSupportedLanguageCode = (languageCode) => Boolean(normalizeSupportedLanguageCode(languageCode));

module.exports = {
  SUPPORTED_LANGUAGE_CODES,
  normalizeSupportedLanguageCode,
  isSupportedLanguageCode,
};
