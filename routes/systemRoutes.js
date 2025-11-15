const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  healthCheck,
  logTestError,
  triggerAlertEmail,
} = require('../controller/systemController');

const router = express.Router();

router.get('/health', healthCheck);
router.post('/diagnostics/error', authMiddleware, logTestError);
router.post('/diagnostics/alert', authMiddleware, triggerAlertEmail);

module.exports = router;


