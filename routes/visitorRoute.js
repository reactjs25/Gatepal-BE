const express = require('express');
const { getDeliveryCompanies, getWorkCategories, addDeliveryCompany } = require('../controller/visitor/visitorController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/deliveryCompanies', userAuthMiddleware, getDeliveryCompanies);
router.get('/workCategories', userAuthMiddleware, getWorkCategories);
router.post('/deliveryCompanies', userAuthMiddleware, addDeliveryCompany);

module.exports = router;
