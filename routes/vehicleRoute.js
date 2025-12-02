const express = require('express');
const { addVehicle, getVehiclesByUnit, editVehicle, deleteVehicle, getVehicleById } = require('../controller/member/vehicleController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/:unitId', userAuthMiddleware, addVehicle);
router.get('/:unitId', userAuthMiddleware, getVehiclesByUnit);
router.get('/:unitId/:vehicleId', userAuthMiddleware, getVehicleById);
router.patch('/:unitId/:vehicleId', userAuthMiddleware, editVehicle);
router.delete('/:unitId/:vehicleId', userAuthMiddleware, deleteVehicle);

module.exports = router;
