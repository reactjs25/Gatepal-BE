const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { healthCheck, logTestError, triggerAlertEmail } = require('../controller/systemController');
const { triggerJobsManually, runMaintenanceReminderJob, runMaintenanceOverdueJob, runContractExpiryJob, runAppInactiveJob } = require('../jobs');
const router = express.Router();

router.get('/health', healthCheck);
router.post('/diagnostics/error', authMiddleware, logTestError);
router.post('/diagnostics/alert', authMiddleware, triggerAlertEmail);

router.post('/jobs/trigger-all', authMiddleware, async (req, res) => {
  try {
    await triggerJobsManually();
    res.json({ success: true, message: 'All scheduled jobs triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.post('/jobs/maintenance-reminder', authMiddleware, async (req, res) => {
  try {
    const result = await runMaintenanceReminderJob();
    res.json({ success: true, message: 'Maintenance reminder job triggered', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/jobs/maintenance-overdue', authMiddleware, async (req, res) => {
  try {
    const result = await runMaintenanceOverdueJob();
    res.json({ success: true, message: 'Maintenance overdue job triggered', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/jobs/contract-expiry', authMiddleware, async (req, res) => {
  try {
    const result = await runContractExpiryJob();
    res.json({ success: true, message: 'Contract expiry job triggered', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/jobs/app-inactive', authMiddleware, async (req, res) => {
  try {
    const result = await runAppInactiveJob();
    res.json({ success: true, message: 'App inactive job triggered', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;






