const express = require('express');
const { getAllSociety } = require('../controller/guard/guardController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.get('/getAllSocieties', userAuthMiddleware, getAllSociety);

module.exports = router;

