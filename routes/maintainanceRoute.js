const express = require('express');
const { uploadMaintainanceProof, getMaintainancesByUnit, getMaintainanceById } = require('../controller/member/maintainanceController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/', userAuthMiddleware, uploadMaintainanceProof);
router.get('/', userAuthMiddleware, getMaintainancesByUnit);
router.get('/:unitId/:maintenanceId', userAuthMiddleware, getMaintainanceById);

module.exports = router;
