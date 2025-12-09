const express = require('express');
const { approveDailyHelp, rejectDailyHelp, removeDailyHelpFromSociety, listSocietyDailyHelp, getSocietyDailyHelpProfileById, addSocietyDailyHelp, editSocietyDailyHelpProfile } = require('../controller/society/dailyHelpAdminController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const router = express.Router();

router.get('/society', userAuthMiddleware, listSocietyDailyHelp);
router.get('/:dailyHelpId', userAuthMiddleware, getSocietyDailyHelpProfileById);
router.post('/add', userAuthMiddleware, addSocietyDailyHelp);
router.post('/approve/:dailyHelpId', userAuthMiddleware, approveDailyHelp);
router.post('/reject/:dailyHelpId', userAuthMiddleware, rejectDailyHelp);
router.patch('/:dailyHelpId', userAuthMiddleware, editSocietyDailyHelpProfile);
router.delete('/remove/:dailyHelpId', userAuthMiddleware, removeDailyHelpFromSociety);


module.exports = router;
