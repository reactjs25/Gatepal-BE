const express = require('express');
const {
    getSocietyInfo,
    getSocietyInfoUnits,
    getSocietyInfoResidents,
    updateSocietyResidentUnit,
    getSocietyInfoVehicles,
    getSocietyInfoPets,
    getSocietyActivitySummary,
} = require('../controller/society/societyInfoController');
const { generateUnitListExcelReport } = require('../controller/society/unitListReportController');
const { generateResidentExcelReport } = require('../controller/society/residentReportController');
const { generateVehicleExcelReport } = require('../controller/society/vehicleReportController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getSocietyInfo);
router.get('/units', userAuthMiddleware, getSocietyInfoUnits);
router.post('/units/report/generate', userAuthMiddleware, generateUnitListExcelReport);
router.get('/residents', userAuthMiddleware, getSocietyInfoResidents);
router.post('/residents/report/generate', userAuthMiddleware, generateResidentExcelReport);
router.patch('/residents/:unitId', userAuthMiddleware, updateSocietyResidentUnit);
router.get('/vehicles', userAuthMiddleware, getSocietyInfoVehicles);
router.post('/vehicles/report/generate', userAuthMiddleware, generateVehicleExcelReport);
router.get('/pets', userAuthMiddleware, getSocietyInfoPets);
router.get('/activitySummary', userAuthMiddleware, getSocietyActivitySummary);

module.exports = router;
