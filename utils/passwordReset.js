const nodemailer = require('nodemailer');
const { URL } = require('url');

const ensureStringValue = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

const createTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP configuration is missing');
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const buildResetUrl = (token, email, options = {}) => {
  const {
    baseUrl,
    fallbackPath = '/reset-password',
    envKey = 'PASSWORD_RESET_URL',
    extraParams = {},
  } = options;

  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  const fallbackBase = `${frontendBase}${fallbackPath}`;

  const candidateUrl =
    baseUrl || (envKey ? process.env[envKey] : undefined) || fallbackBase;

  const applySearchParams = (urlInstance) => {
    urlInstance.searchParams.set('token', token);
    urlInstance.searchParams.set('email', email);

    Object.entries(extraParams).forEach(([key, value]) => {
      const normalized = ensureStringValue(value);
      if (normalized !== undefined) {
        urlInstance.searchParams.set(key, normalized);
      }
    });

    return urlInstance.toString();
  };

  try {
    const initialUrl = new URL(candidateUrl);
    return applySearchParams(initialUrl);
  } catch (error) {
    try {
      const relativeUrl = new URL(candidateUrl, fallbackBase);
      return applySearchParams(relativeUrl);
    } catch (nestedError) {
      const searchParams = new URLSearchParams();
      searchParams.set('token', token);
      searchParams.set('email', email);

      Object.entries(extraParams).forEach(([key, value]) => {
        const normalized = ensureStringValue(value);
        if (normalized !== undefined) {
          searchParams.set(key, normalized);
        }
      });

      const separator = candidateUrl.includes('?') ? '&' : '?';
      return `${candidateUrl}${separator}${searchParams.toString()}`;
    }
  }
};

module.exports = {
  createTransporter,
  buildResetUrl,
};



