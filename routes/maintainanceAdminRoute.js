const express = require('express');
const { getMaintenanceYearlySummary, listUploadedMaintenanceByMonth, getMaintenanceSummaryByMonth, verifyMaintenance, rejectMaintenance } = require('../controller/society/maintainanceAdminController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, listUploadedMaintenanceByMonth);

router.get('/summary/yearly', userAuthMiddleware, getMaintenanceYearlySummary);

router.get('/summary', userAuthMiddleware, getMaintenanceSummaryByMonth);

router.post('/verify', userAuthMiddleware, verifyMaintenance);

router.post('/reject', userAuthMiddleware, rejectMaintenance);

module.exports = router;
