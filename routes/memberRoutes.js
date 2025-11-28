const express = require('express');
const { addMemberUnit, updateUnitOccupancyStatus, getUnitById } = require('../controller/member/unitController');
const { getMemberProfile, updateMemberProfile } = require('../controller/member/profileController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/units', userAuthMiddleware, addMemberUnit);
router.patch('/units/:id', userAuthMiddleware, updateUnitOccupancyStatus);
router.get('/profile', userAuthMiddleware, getMemberProfile);
router.get('/units/:id', userAuthMiddleware, getUnitById);
router.patch('/profile', userAuthMiddleware, updateMemberProfile);


module.exports = router;
