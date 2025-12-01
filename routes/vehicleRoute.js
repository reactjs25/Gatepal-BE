const express = require('express');
const { addVehicle, getVehiclesByUnit, editVehicle, deleteVehicle, getVehicleById } = require('../controller/member/vehicleController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/units/:unitId', userAuthMiddleware, addVehicle);
router.get('/units/:unitId', userAuthMiddleware, getVehiclesByUnit);
router.get('/units/:unitId/:vehicleId', userAuthMiddleware, getVehicleById);
router.patch('/units/:unitId/:vehicleId', userAuthMiddleware, editVehicle);
router.delete('/units/:unitId/:vehicleId', userAuthMiddleware, deleteVehicle);

module.exports = router;
