const express = require('express');
const { addMemberUnit, listMemberUnits, switchActiveUnit } = require('../controller/member/unitController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/units', userAuthMiddleware, addMemberUnit);
router.get('/units', userAuthMiddleware, listMemberUnits);


module.exports = router;

