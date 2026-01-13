const express = require('express');
const {
    getSocietyInfo,
    getSocietyInfoUnits,
    getSocietyInfoResidents,
    getSocietyInfoVehicles,
    getSocietyInfoPets,
    getSocietyActivitySummary,
} = require('../controller/society/societyInfoController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getSocietyInfo);
router.get('/units', userAuthMiddleware, getSocietyInfoUnits);
router.get('/residents', userAuthMiddleware, getSocietyInfoResidents);
router.get('/vehicles', userAuthMiddleware, getSocietyInfoVehicles);
router.get('/pets', userAuthMiddleware, getSocietyInfoPets);
router.get('/activitySummary', userAuthMiddleware, getSocietyActivitySummary);

module.exports = router;
