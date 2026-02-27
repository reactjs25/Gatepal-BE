const cron = require('node-cron');
const Society = require('../model/societySchema');
const { generateAndUploadMaintenanceReport } = require('../service/report/maintenanceReportService');
const config = require('../config/appConfig');

const DEFAULT_SCHEDULE = '0 0 * * *';
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_BATCH_SIZE = 10;
const STATUSES = ['uploaded', 'verified', 'rejected'];

const processInBatches = async (items, worker, batchSize = DEFAULT_BATCH_SIZE) => {
  const normalizedBatchSize = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    const batch = items.slice(index, index + normalizedBatchSize);
    await Promise.allSettled(batch.map((item) => worker(item)));
  }
};

const runMaintenanceReportDailyJob = async () => {
  console.log('[MaintenanceReportJob] Starting daily maintenance report generation');

  try {
    const societies = await Society.find({
      status: { $in: ['Active', 'Trial'] },
    })
      .select({ _id: 1 })
      .lean();

    if (!societies.length) {
      console.log('[MaintenanceReportJob] No active societies found');
      return;
    }

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.toLocaleString('en-US', { month: 'long' });

    let successCount = 0;
    let failureCount = 0;

    await processInBatches(
      societies,
      async (society) => {
        const societyId = String(society._id);

        const results = await Promise.allSettled(
          STATUSES.map((status) =>
            generateAndUploadMaintenanceReport({
              societyId,
              month: currentMonth,
              year: currentYear,
              status,
            })
          )
        );

        const hasFailure = results.some((result) => result.status === 'rejected');
        if (hasFailure) {
          failureCount += 1;
          console.error(`[MaintenanceReportJob] Failed for society ${societyId}`);
          return;
        }

        successCount += 1;
      },
      config.reports.maintenanceReportBatchSize
    );

    console.log(
      `[MaintenanceReportJob] Completed. Success: ${successCount}, Failed: ${failureCount}, Total: ${societies.length}`
    );
  } catch (error) {
    console.error('[MaintenanceReportJob] Job failed:', error.message);
  }
};

const initializeMaintenanceReportJob = () => {
  if (!config.reports.maintenanceReportCronEnabled) {
    return;
  }

  const schedule = config.reports.maintenanceReportCronSchedule || DEFAULT_SCHEDULE;
  const timezone = config.reports.maintenanceReportCronTimezone || DEFAULT_TIMEZONE;

  console.log(`[MaintenanceReportJob] Initializing with schedule "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      await runMaintenanceReportDailyJob();
    },
    { timezone }
  );
};

module.exports = {
  initializeMaintenanceReportJob,
  runMaintenanceReportDailyJob,
};
