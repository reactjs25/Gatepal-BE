const express = require('express');
const { getGuardLogs } = require('../controller/society/guardLogController');
const { generateGuardLogExcelReport } = require('../controller/society/guardLogReportController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getGuardLogs);
router.post('/report/generate', userAuthMiddleware, generateGuardLogExcelReport);

module.exports = router;
