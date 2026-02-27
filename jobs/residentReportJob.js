const cron = require('node-cron');
const Society = require('../model/societySchema');
const { generateAndUploadResidentReport } = require('../service/report/residentReportService');
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

const runResidentReportDailyJob = async () => {
  console.log('[ResidentReportJob] Starting daily resident report generation');

  try {
    const societies = await Society.find({
      status: { $in: ['Active', 'Trial'] },
    })
      .select({ _id: 1 })
      .lean();

    if (!societies.length) {
      console.log('[ResidentReportJob] No active societies found');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    await processInBatches(
      societies,
      async (society) => {
        const societyId = String(society._id);

        const result = await Promise.allSettled([
          generateAndUploadResidentReport({ societyId }),
        ]);

        if (result[0]?.status === 'rejected') {
          failureCount += 1;
          console.error(`[ResidentReportJob] Failed for society ${societyId}`);
          return;
        }

        successCount += 1;
      },
      config.reports.residentReportBatchSize
    );

    console.log(
      `[ResidentReportJob] Completed. Success: ${successCount}, Failed: ${failureCount}, Total: ${societies.length}`
    );
  } catch (error) {
    console.error('[ResidentReportJob] Job failed:', error.message);
  }
};

const initializeResidentReportJob = () => {
  if (!config.reports.residentReportCronEnabled) {
    return;
  }

  const schedule = config.reports.residentReportCronSchedule || DEFAULT_SCHEDULE;
  const timezone = config.reports.residentReportCronTimezone || DEFAULT_TIMEZONE;

  console.log(`[ResidentReportJob] Initializing with schedule "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      await runResidentReportDailyJob();
    },
    { timezone }
  );
};

module.exports = {
  initializeResidentReportJob,
  runResidentReportDailyJob,
};
