const express = require('express');
const {
  getMaintenanceYearlySummary,
  listUploadedMaintenanceByMonth,
  getMaintenanceSummaryByMonth,
  verifyMaintenance,
  rejectMaintenance,
  getMaintenanceRejectReasonCategories,
} = require('../controller/society/maintainanceAdminController');
const { generateMaintenanceExcelReport } = require('../controller/society/maintenanceReportController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, listUploadedMaintenanceByMonth);

router.get('/summary/yearly', userAuthMiddleware, getMaintenanceYearlySummary);

router.get('/summary', userAuthMiddleware, getMaintenanceSummaryByMonth);

router.get('/rejectReasonCategories', userAuthMiddleware, getMaintenanceRejectReasonCategories);
router.post('/report/generate', userAuthMiddleware, generateMaintenanceExcelReport);

router.post('/verify', userAuthMiddleware, verifyMaintenance);

router.post('/reject', userAuthMiddleware, rejectMaintenance);

module.exports = router;
