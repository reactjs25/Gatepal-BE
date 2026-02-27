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
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getSocietyInfo);
router.get('/units', userAuthMiddleware, getSocietyInfoUnits);
router.post('/units/report/generate', userAuthMiddleware, generateUnitListExcelReport);
router.get('/residents', userAuthMiddleware, getSocietyInfoResidents);
router.patch('/residents/:unitId', userAuthMiddleware, updateSocietyResidentUnit);
router.get('/vehicles', userAuthMiddleware, getSocietyInfoVehicles);
router.get('/pets', userAuthMiddleware, getSocietyInfoPets);
router.get('/activitySummary', userAuthMiddleware, getSocietyActivitySummary);

module.exports = router;
