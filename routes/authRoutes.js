const express = require('express');
const { signIn } = require('../controller/authController');
const router = express.Router();

router.post('/signin', signIn);

module.exports = router;

