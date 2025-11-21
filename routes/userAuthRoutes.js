const express = require('express');
const {
  login,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
} = require('../controller/userAuthController');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', requestPasswordOtp);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

module.exports = router;


