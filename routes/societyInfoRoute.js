const express = require('express');
const { getSocietyInfo } = require('../controller/society/societyInfoController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/', userAuthMiddleware, getSocietyInfo);

module.exports = router;

