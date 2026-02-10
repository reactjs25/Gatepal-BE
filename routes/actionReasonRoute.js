const express = require('express');
const { getActionReasons } = require('../controller/actionReasonController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getActionReasons);

module.exports = router;
