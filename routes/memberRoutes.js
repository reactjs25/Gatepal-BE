const express = require('express');
const { addMemberUnit } = require('../controller/member/unitController');
const { getMemberProfile } = require('../controller/member/profileController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/units', userAuthMiddleware, addMemberUnit);
router.get('/profile', userAuthMiddleware, getMemberProfile);


module.exports = router;

