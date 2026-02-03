/**
 * Scheduled Jobs Index
 * Initializes and manages all scheduled cron jobs
 * 
 * Schedule: Daily at 9:00 AM IST (3:30 AM UTC)
 */

const cron = require('node-cron');
const { runMaintenanceReminderJob } = require('./maintenanceReminderJob');
const { runMaintenanceOverdueJob } = require('./maintenanceOverdueJob');
const { runContractExpiryJob } = require('./contractExpiryJob');
const { runAppInactiveJob } = require('./appInactiveJob');

// IST is UTC+5:30, so 9:00 AM IST = 3:30 AM UTC
const DAILY_SCHEDULE_UTC = '30 3 * * *';

// For development/testing - run every minute
// const TEST_SCHEDULE = '* * * * *';

/**
 * Run all scheduled jobs sequentially
 */
const runAllJobs = async () => {
  console.log('[ScheduledJobs] ====================================');
  console.log('[ScheduledJobs] Starting daily scheduled jobs at', new Date().toISOString());
  console.log('[ScheduledJobs] ====================================');

  try {
    // 1. Maintenance Reminder Job (5 days before due)
    console.log('[ScheduledJobs] Running Maintenance Reminder Job...');
    await runMaintenanceReminderJob();

    // 2. Maintenance Overdue Job (after due date)
    console.log('[ScheduledJobs] Running Maintenance Overdue Job...');
    await runMaintenanceOverdueJob();

    // 3. Contract Expiry Job (3 months before)
    console.log('[ScheduledJobs] Running Contract Expiry Job...');
    await runContractExpiryJob();

    // 4. App Inactive Job (after contract expired)
    console.log('[ScheduledJobs] Running App Inactive Job...');
    await runAppInactiveJob();

    console.log('[ScheduledJobs] ====================================');
    console.log('[ScheduledJobs] All scheduled jobs completed at', new Date().toISOString());
    console.log('[ScheduledJobs] ====================================');
  } catch (error) {
    console.error('[ScheduledJobs] Error running scheduled jobs:', error.message);
  }
};

/**
 * Initialize all cron jobs
 */
const initializeScheduledJobs = () => {
  console.log('[ScheduledJobs] Initializing scheduled jobs...');
  console.log('[ScheduledJobs] Schedule: Daily at 9:00 AM IST (3:30 AM UTC)');

  // Schedule daily job at 9:00 AM IST
  cron.schedule(DAILY_SCHEDULE_UTC, async () => {
    await runAllJobs();
  }, {
    timezone: 'UTC',
  });

  console.log('[ScheduledJobs] Scheduled jobs initialized successfully');
};

/**
 * Manual trigger for testing
 * Can be called from an API endpoint for testing
 */
const triggerJobsManually = async () => {
  console.log('[ScheduledJobs] Manual trigger requested');
  await runAllJobs();
};

module.exports = {
  initializeScheduledJobs,
  triggerJobsManually,
  runMaintenanceReminderJob,
  runMaintenanceOverdueJob,
  runContractExpiryJob,
  runAppInactiveJob,
};
