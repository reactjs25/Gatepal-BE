const express = require('express');
const { getSocietyInfo, getSocietyActivitySummary } = require('../controller/society/societyInfoController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getSocietyInfo);
router.get('/activitySummary', userAuthMiddleware, getSocietyActivitySummary);

module.exports = router;
