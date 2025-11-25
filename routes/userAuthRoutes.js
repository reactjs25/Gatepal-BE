const express = require('express');
const { login, requestPasswordOtp, verifyOtp, resetPassword } = require('../controller/userAuthController');  
const { registerUser, verifyRegistrationOtp, completeOnboarding } = require('../controller/userRegistrationController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/register', registerUser);
router.post('/register/verifyOtp', verifyRegistrationOtp);
router.post('/onboarding', userAuthMiddleware, completeOnboarding);
router.post('/login', login);
router.post('/forgotPassword', requestPasswordOtp);
router.post('/verifyOtp', verifyOtp);
router.post('/resetPassword', resetPassword);

module.exports = router;


