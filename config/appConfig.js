const dotenv = require('dotenv');
dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeList = (value) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const config = {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: toNumber(process.env.PORT, 3003),
  },
  cors: {
    origins: normalizeList(process.env.CORS_ORIGINS),
  },
  database: {
    uri: process.env.MONGO_URI,
    alertDebounceMs: toNumber(process.env.DB_ALERT_DEBOUNCE_MS, 15 * 60 * 1000),
  },
};

module.exports = config;

