const express = require('express');
const { signUp, login, forgotPassword, resetPassword } = require('../controller/authController');

const router = express.Router();

router.post('/signup', signUp);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;

