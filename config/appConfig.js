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
    residentReportCronEnabled: String(process.env.RESIDENT_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    residentReportCronSchedule: process.env.RESIDENT_REPORT_CRON_SCHEDULE || '0 0 * * *',
    residentReportCronTimezone: process.env.RESIDENT_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    residentReportBatchSize: toNumber(process.env.RESIDENT_REPORT_BATCH_SIZE, 10),
    maintenanceReportCronEnabled:
      String(process.env.MAINTENANCE_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    maintenanceReportCronSchedule: process.env.MAINTENANCE_REPORT_CRON_SCHEDULE || '0 0 * * *',
    maintenanceReportCronTimezone: process.env.MAINTENANCE_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    maintenanceReportBatchSize: toNumber(process.env.MAINTENANCE_REPORT_BATCH_SIZE, 10),
    vehicleReportCronEnabled: String(process.env.VEHICLE_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    vehicleReportCronSchedule: process.env.VEHICLE_REPORT_CRON_SCHEDULE || '0 0 * * *',
    vehicleReportCronTimezone: process.env.VEHICLE_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    vehicleReportBatchSize: toNumber(process.env.VEHICLE_REPORT_BATCH_SIZE, 10),
    petReportCronEnabled: String(process.env.PET_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    petReportCronSchedule: process.env.PET_REPORT_CRON_SCHEDULE || '0 0 * * *',
    petReportCronTimezone: process.env.PET_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    petReportBatchSize: toNumber(process.env.PET_REPORT_BATCH_SIZE, 10),
    guardsLogBatchSize: toNumber(process.env.GUARDS_LOG_REPORT_BATCH_SIZE, 10),
    visitorLogCronEnabled: String(process.env.VISITOR_LOG_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    visitorLogCronSchedule: process.env.VISITOR_LOG_REPORT_CRON_SCHEDULE || '0 0 * * *',
    visitorLogCronTimezone: process.env.VISITOR_LOG_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    visitorLogBatchSize: toNumber(process.env.VISITOR_LOG_REPORT_BATCH_SIZE, 10),
    unitListCronEnabled: String(process.env.UNIT_LIST_REPORT_CRON_ENABLED || 'false').toLowerCase() === 'true',
    unitListCronSchedule: process.env.UNIT_LIST_REPORT_CRON_SCHEDULE || '0 0 * * *',
    unitListCronTimezone: process.env.UNIT_LIST_REPORT_CRON_TIMEZONE || 'Asia/Kolkata',
    unitListBatchSize: toNumber(process.env.UNIT_LIST_REPORT_BATCH_SIZE, 10),
  },
};

module.exports = config;

