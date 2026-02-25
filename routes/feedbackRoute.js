const express = require('express');
const { submitFeedback, getMyFeedback, updateFeedback } = require('../controller/feedbackController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();


router.get('/', userAuthMiddleware, getMyFeedback);


router.post('/', userAuthMiddleware, submitFeedback);


router.put('/:id', userAuthMiddleware, updateFeedback);

module.exports = router;
