const express = require('express');
const { getTaxiDriverCompanies } = require('../controller/visitor/visitorController');
const { getVisitorProfile, updateVisitorProfile } = require('../controller/visitor/visitorProfileController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/getProfile', userAuthMiddleware, getVisitorProfile);
router.put('/updateProfile', userAuthMiddleware, updateVisitorProfile);
router.get('/taxiDriverCompanies', userAuthMiddleware, getTaxiDriverCompanies);

module.exports = router;
