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
  aws: {
    region: process.env.AWS_REGION || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Bucket: process.env.AWS_S3_BUCKET || '',
    s3SignedUrlTtlSeconds: toNumber(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS, 900),
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

