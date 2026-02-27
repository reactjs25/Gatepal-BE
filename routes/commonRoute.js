const express = require('express');
const {
  getDeliveryCompanies,
  getTaxiDriverCompanies,
  getWorkCategories,
  getOtherVisitorCompanies,
  addDeliveryCompany,
  addTaxiDriverCompany,
  addOtherVisitorCompany,
} = require('../controller/visitor/visitorController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/deliveryCompanies', userAuthMiddleware, getDeliveryCompanies);
router.get('/taxiDriverCompanies', userAuthMiddleware, getTaxiDriverCompanies);
router.get('/workCategories', userAuthMiddleware, getWorkCategories);
router.get('/otherVisitorCompanies', userAuthMiddleware, getOtherVisitorCompanies);
router.post('/deliveryCompanies', userAuthMiddleware, addDeliveryCompany);
router.post('/taxiDriverCompanies', userAuthMiddleware, addTaxiDriverCompany);
router.post('/otherVisitorCompanies', userAuthMiddleware, addOtherVisitorCompany);

module.exports = router;
