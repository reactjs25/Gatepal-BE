const express = require('express');
const { approveDailyHelp, rejectDailyHelp, removeDailyHelpFromSociety, listSocietyDailyHelp, getSocietyDailyHelpProfileById } = require('../controller/society/dailyHelpAdminController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.get('/society', userAuthMiddleware, listSocietyDailyHelp);
router.post('/:dailyHelpId/approve', userAuthMiddleware, approveDailyHelp);
router.post('/:dailyHelpId/reject', userAuthMiddleware, rejectDailyHelp);
router.delete('/:dailyHelpId/remove', userAuthMiddleware, removeDailyHelpFromSociety);
router.get('/:dailyHelpId', userAuthMiddleware, getSocietyDailyHelpProfileById);

module.exports = router;
