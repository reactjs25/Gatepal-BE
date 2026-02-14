const express = require('express');
const {
  login,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
  registerFcmToken,
  removeFcmToken,
  getPreferences,
  updatePreferences,
} = require('../controller/userAuthController');
const { registerUser, verifyRegistrationOtp, completeOnboarding } = require('../controller/userRegistrationController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const { notifyMissingLocation } = require('../controller/societyHierarchy');

const router = express.Router();

router.post('/register', registerUser);
router.post('/register/verifyOtp', verifyRegistrationOtp);
router.post('/onboarding', userAuthMiddleware, completeOnboarding);
router.post('/login', login);
router.post('/forgotPassword', requestPasswordOtp);
router.post('/verifyOtp', verifyOtp);
router.post('/resetPassword', resetPassword);
router.post('/notify', userAuthMiddleware, notifyMissingLocation);


router.post('/fcm-token', userAuthMiddleware, registerFcmToken);
router.delete('/fcm-token', userAuthMiddleware, removeFcmToken);
router.get('/preferences', userAuthMiddleware, getPreferences);
router.patch('/preferences', userAuthMiddleware, updatePreferences);

module.exports = router;

