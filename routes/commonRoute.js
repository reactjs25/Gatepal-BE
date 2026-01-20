const express = require('express');
const {
  getDeliveryCompanies,
  getTaxiDriverCompanies,
} = require('../controller/visitor/visitorController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/deliveryCompanies', userAuthMiddleware, getDeliveryCompanies);
router.get('/taxiDriverCompanies', userAuthMiddleware, getTaxiDriverCompanies);

module.exports = router;
