const express = require('express');
const { getGuardLogs } = require('../controller/society/guardLogController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getGuardLogs);

module.exports = router;
