const express = require('express');
const { getAllSociety, updateGuardProfile, addSociety, getGuardProfile, startDuty, endDuty } = require('../controller/guard/guardController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/getAllSocieties', userAuthMiddleware, getAllSociety);
router.get('/getProfile', userAuthMiddleware, getGuardProfile);
router.put('/updateProfile', userAuthMiddleware, updateGuardProfile);
router.post('/addSociety', userAuthMiddleware, addSociety);
router.post('/startDuty', userAuthMiddleware, startDuty);
router.post('/endDuty', userAuthMiddleware, endDuty);

module.exports = router;

