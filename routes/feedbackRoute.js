const express = require('express');
const { submitFeedback } = require('../controller/feedbackController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/', userAuthMiddleware, submitFeedback);

module.exports = router;
