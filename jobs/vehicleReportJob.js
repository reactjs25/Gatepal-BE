const cron = require('node-cron');
const Society = require('../model/societySchema');
const { generateAndUploadVehicleReport } = require('../service/report/vehicleReportService');
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

const runVehicleReportDailyJob = async () => {
  console.log('[VehicleReportJob] Starting daily vehicle report generation');

  try {
    const societies = await Society.find({
      status: { $in: ['Active', 'Trial'] },
    })
      .select({ _id: 1 })
      .lean();

    if (!societies.length) {
      console.log('[VehicleReportJob] No active societies found');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    await processInBatches(
      societies,
      async (society) => {
        const societyId = String(society._id);

        const result = await Promise.allSettled([
          generateAndUploadVehicleReport({ societyId }),
        ]);

        if (result[0]?.status === 'rejected') {
          failureCount += 1;
          console.error(`[VehicleReportJob] Failed for society ${societyId}`);
          return;
        }

        successCount += 1;
      },
      config.reports.vehicleReportBatchSize
    );

    console.log(
      `[VehicleReportJob] Completed. Success: ${successCount}, Failed: ${failureCount}, Total: ${societies.length}`
    );
  } catch (error) {
    console.error('[VehicleReportJob] Job failed:', error.message);
  }
};

const initializeVehicleReportJob = () => {
  if (!config.reports.vehicleReportCronEnabled) {
    return;
  }

  const schedule = config.reports.vehicleReportCronSchedule || DEFAULT_SCHEDULE;
  const timezone = config.reports.vehicleReportCronTimezone || DEFAULT_TIMEZONE;

  console.log(`[VehicleReportJob] Initializing with schedule "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      await runVehicleReportDailyJob();
    },
    { timezone }
  );
};

module.exports = {
  initializeVehicleReportJob,
  runVehicleReportDailyJob,
};
