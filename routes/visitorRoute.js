const express = require('express');
const {
  getDeliveryCompanies,
  getWorkCategories,
  getTaxiDriverCompanies,
  addDeliveryCompany,
} = require('../controller/visitor/visitorController');
const { getVisitorProfile, updateVisitorProfile } = require('../controller/visitor/visitorProfileController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/getProfile', userAuthMiddleware, getVisitorProfile);
router.put('/updateProfile', userAuthMiddleware, updateVisitorProfile);
router.get('/deliveryCompanies', userAuthMiddleware, getDeliveryCompanies);
router.get('/taxiDriverCompanies', userAuthMiddleware, getTaxiDriverCompanies);
router.post('/deliveryCompanies', userAuthMiddleware, addDeliveryCompany);

module.exports = router;
