const express = require('express');
const { addDailyHelp, getDailyHelpByStatus, removeDailyHelpFromUnit, editDailyHelpProfile, getDailyHelpProfileById } = require('../controller/member/dailyHelpController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.post('/:unitId', userAuthMiddleware, addDailyHelp);
router.get('/:unitId', userAuthMiddleware, getDailyHelpByStatus);
router.get('/:unitId/:dailyHelpId', userAuthMiddleware, getDailyHelpProfileById);
router.patch('/:unitId/:dailyHelpId', userAuthMiddleware, editDailyHelpProfile);
router.delete('/:unitId/:dailyHelpId', userAuthMiddleware, removeDailyHelpFromUnit);

module.exports = router;
