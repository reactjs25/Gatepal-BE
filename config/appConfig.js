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
  },
  cors: {
    origins: normalizeList(process.env.CORS_ORIGINS),
  },
  database: {
    uri: process.env.MONGO_URI,
    alertDebounceMs: toNumber(process.env.DB_ALERT_DEBOUNCE_MS, 15 * 60 * 1000),
  },
  reports: {
    guardsLogCronEnabled: String(process.env.GUARDS_LOG_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    guardsLogCronSchedule: process.env.GUARDS_LOG_REPORT_CRON_SCHEDULE || '0 0 * * *',
    guardsLogCronTimezone: process.env.GUARDS_LOG_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    guardsLogBatchSize: toNumber(process.env.GUARDS_LOG_REPORT_BATCH_SIZE, 10),
  },
};

module.exports = config;

