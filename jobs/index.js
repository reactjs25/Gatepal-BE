






const cron = require('node-cron');
const { runMaintenanceReminderJob } = require('./maintenanceReminderJob');
const { runMaintenanceOverdueJob } = require('./maintenanceOverdueJob');
const { runContractExpiryJob } = require('./contractExpiryJob');
const { runAppInactiveJob } = require('./appInactiveJob');
const { initializeGuardsLogReportJob, runGuardsLogReportDailyJob } = require('./guardsLogReportJob');
const { initializeVisitorLogReportJob, runVisitorLogReportDailyJob } = require('./visitorLogReportJob');
const { initializeUnitListReportJob, runUnitListReportDailyJob } = require('./unitListReportJob');
const { initializeResidentReportJob, runResidentReportDailyJob } = require('./residentReportJob');


const DAILY_SCHEDULE_UTC = '30 3 * * *';







const runAllJobs = async () => {
  console.log('[ScheduledJobs] ====================================');
  console.log('[ScheduledJobs] Starting daily scheduled jobs at', new Date().toISOString());
  console.log('[ScheduledJobs] ====================================');

  try {
    
    console.log('[ScheduledJobs] Running Maintenance Reminder Job...');
    await runMaintenanceReminderJob();

    
    console.log('[ScheduledJobs] Running Maintenance Overdue Job...');
    await runMaintenanceOverdueJob();

    
    console.log('[ScheduledJobs] Running Contract Expiry Job...');
    await runContractExpiryJob();

    
    console.log('[ScheduledJobs] Running App Inactive Job...');
    await runAppInactiveJob();

    console.log('[ScheduledJobs] ====================================');
    console.log('[ScheduledJobs] All scheduled jobs completed at', new Date().toISOString());
    console.log('[ScheduledJobs] ====================================');
  } catch (error) {
    console.error('[ScheduledJobs] Error running scheduled jobs:', error.message);
  }
};




const initializeScheduledJobs = () => {
  console.log('[ScheduledJobs] Initializing scheduled jobs...');
  console.log('[ScheduledJobs] Schedule: Daily at 9:00 AM IST (3:30 AM UTC)');

  
  cron.schedule(DAILY_SCHEDULE_UTC, async () => {
    await runAllJobs();
  }, {
    timezone: 'UTC',
  });

  initializeGuardsLogReportJob();
  initializeVisitorLogReportJob();
  initializeUnitListReportJob();
  initializeResidentReportJob();

  console.log('[ScheduledJobs] Scheduled jobs initialized successfully');
};





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
  runGuardsLogReportDailyJob,
  runVisitorLogReportDailyJob,
  runUnitListReportDailyJob,
  runResidentReportDailyJob,
};
