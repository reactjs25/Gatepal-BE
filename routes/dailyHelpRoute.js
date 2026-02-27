const express = require('express');
const { getDailyHelpCategories, addDailyHelp, getDailyHelpByStatus, removeDailyHelpFromUnit, editDailyHelpProfile, getDailyHelpProfileById, searchApprovedSocietyDailyHelp, assignExistingDailyHelpToUnit } = require('../controller/member/dailyHelpController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.get('/categories', userAuthMiddleware, getDailyHelpCategories);
router.post('/:unitId', userAuthMiddleware, addDailyHelp);
router.get('/society/:unitId/:category', userAuthMiddleware, searchApprovedSocietyDailyHelp);
router.get('/:unitId', userAuthMiddleware, getDailyHelpByStatus);
router.post('/:unitId/:dailyHelpId', userAuthMiddleware, assignExistingDailyHelpToUnit);
router.get('/:unitId/:dailyHelpId', userAuthMiddleware, getDailyHelpProfileById);
router.patch('/:unitId/:dailyHelpId', userAuthMiddleware, editDailyHelpProfile);
router.delete('/:unitId/:dailyHelpId', userAuthMiddleware, removeDailyHelpFromUnit);

module.exports = router;
