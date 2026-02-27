const SUPPORTED_LANGUAGE_CODES = Object.freeze([
  'en',
  'hi',
  'gu',
]);

const isSupportedLanguageCode = (languageCode) => SUPPORTED_LANGUAGE_CODES.includes(languageCode);

module.exports = {
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguageCode,
};
