const cron = require('node-cron');
const Society = require('../model/societySchema');
const { generateAndUploadVisitorLogReport } = require('../service/report/visitorLogReportService');
const config = require('../config/appConfig');

const DEFAULT_SCHEDULE = '0 0 * * *';
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_BATCH_SIZE = 10;

const processInBatches = async (items, worker, batchSize = DEFAULT_BATCH_SIZE) => {
  const normalizedBatchSize = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    const batch = items.slice(index, index + normalizedBatchSize);
    await Promise.allSettled(batch.map((item) => worker(item)));
  }
};

const runVisitorLogReportDailyJob = async () => {
  console.log('[VisitorLogReportJob] Starting daily visitor log report generation');

  try {
    const societies = await Society.find({
      status: { $in: ['Active', 'Trial'] },
    })
      .select({ _id: 1 })
      .lean();

    if (!societies.length) {
      console.log('[VisitorLogReportJob] No active societies found');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    await processInBatches(
      societies,
      async (society) => {
        const societyId = String(society._id);

        const results = await Promise.allSettled([
          generateAndUploadVisitorLogReport({ societyId, filter: 'today' }),
          generateAndUploadVisitorLogReport({ societyId, filter: 'this_month' }),
        ]);

        const hasFailure = results.some((result) => result.status === 'rejected');
        if (hasFailure) {
          failureCount += 1;
          console.error(`[VisitorLogReportJob] Failed for society ${societyId}`);
          return;
        }

        successCount += 1;
      },
      config.reports.visitorLogBatchSize
    );

    console.log(
      `[VisitorLogReportJob] Completed. Success: ${successCount}, Failed: ${failureCount}, Total: ${societies.length}`
    );
  } catch (error) {
    console.error('[VisitorLogReportJob] Job failed:', error.message);
  }
};

const initializeVisitorLogReportJob = () => {
  if (!config.reports.visitorLogCronEnabled) {
    return;
  }

  const schedule = config.reports.visitorLogCronSchedule || DEFAULT_SCHEDULE;
  const timezone = config.reports.visitorLogCronTimezone || DEFAULT_TIMEZONE;

  console.log(`[VisitorLogReportJob] Initializing with schedule "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      await runVisitorLogReportDailyJob();
    },
    { timezone }
  );
};

module.exports = {
  initializeVisitorLogReportJob,
  runVisitorLogReportDailyJob,
};
