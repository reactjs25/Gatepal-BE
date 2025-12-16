const express = require('express');
const { getMaintenanceYearlySummary, listUploadedMaintenanceByMonth, getMaintenanceSummaryByMonth, verifyMaintenance, rejectMaintenance } = require('../controller/society/maintainanceAdminController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/summary/yearly', userAuthMiddleware, getMaintenanceYearlySummary);
router.get('/summary/:month', userAuthMiddleware, getMaintenanceSummaryByMonth);
router.get('/:month', userAuthMiddleware, listUploadedMaintenanceByMonth);
router.post('/verify/:maintenanceId', userAuthMiddleware, verifyMaintenance);
router.post('/reject/:maintenanceId', userAuthMiddleware, rejectMaintenance);

module.exports = router;
