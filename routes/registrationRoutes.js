const express = require('express');
const {
  initiateRegistration,
  verifyRegistrationOtp,
  resendRegistrationOtp,
} = require('../controller/registrationController');

const router = express.Router();

router.post('/start', initiateRegistration);
router.post('/verify', verifyRegistrationOtp);
router.post('/resend', resendRegistrationOtp);

module.exports = router;


