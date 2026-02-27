const cron = require('node-cron');
const Society = require('../model/societySchema');
const { generateAndUploadGuardsLogReport } = require('../service/report/guardsLogReportService');
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

const runGuardsLogReportDailyJob = async () => {
  console.log('[GuardsLogReportJob] Starting daily guards log report generation');

  try {
    const societies = await Society.find({
      status: { $in: ['Active', 'Trial'] },
    })
      .select({ _id: 1 })
      .lean();

    if (!societies.length) {
      console.log('[GuardsLogReportJob] No active societies found');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    await processInBatches(
      societies,
      async (society) => {
        const societyId = String(society._id);

        const results = await Promise.allSettled([
          generateAndUploadGuardsLogReport({ societyId, filter: 'today' }),
          generateAndUploadGuardsLogReport({ societyId, filter: 'this_month' }),
        ]);

        const hasFailure = results.some((result) => result.status === 'rejected');
        if (hasFailure) {
          failureCount += 1;
          console.error(`[GuardsLogReportJob] Failed for society ${societyId}`);
          return;
        }

        successCount += 1;
      },
      config.reports.guardsLogBatchSize
    );

    console.log(
      `[GuardsLogReportJob] Completed. Success: ${successCount}, Failed: ${failureCount}, Total: ${societies.length}`
    );
  } catch (error) {
    console.error('[GuardsLogReportJob] Job failed:', error.message);
  }
};

const initializeGuardsLogReportJob = () => {
  if (!config.reports.guardsLogCronEnabled) {
    return;
  }

  const schedule = config.reports.guardsLogCronSchedule || DEFAULT_SCHEDULE;
  const timezone = config.reports.guardsLogCronTimezone || DEFAULT_TIMEZONE;

  console.log(`[GuardsLogReportJob] Initializing with schedule "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      await runGuardsLogReportDailyJob();
    },
    { timezone }
  );
};

module.exports = {
  initializeGuardsLogReportJob,
  runGuardsLogReportDailyJob,
};
