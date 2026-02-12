const express = require('express');
const { submitFeedback, getMyFeedback, updateFeedback } = require('../controller/feedbackController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

// Get logged-in user's feedback (returns null if none).
router.get('/', userAuthMiddleware, getMyFeedback);

// Create feedback if none; otherwise update existing (prevents duplicates).
router.post('/', userAuthMiddleware, submitFeedback);

// Update an existing feedback (only owner can update).
router.put('/:id', userAuthMiddleware, updateFeedback);

module.exports = router;
