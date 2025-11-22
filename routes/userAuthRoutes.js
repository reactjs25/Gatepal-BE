const express = require('express');
const {
  login,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
} = require('../controller/userAuthController');
const {
  registerUser,
  verifyRegistrationOtp,
  completeOnboarding,
} = require('../controller/userRegistrationController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/register', registerUser);
router.post('/register/verify-otp', verifyRegistrationOtp);
router.post('/onboarding', userAuthMiddleware, completeOnboarding);
router.post('/login', login);
router.post('/forgot-password', requestPasswordOtp);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

module.exports = router;


