const express = require('express');
const superAdminAuthRoutes = require('./authRoutes');
const userAuthRoutes = require('./userAuthRoutes');
const societyRoutes = require('./societyRoutes');
const societyAdminRoutes = require('./societyAdminRoutes');
const systemRoutes = require('./systemRoutes');
const visitorRoutes = require('./visitorRoute');
const dailyHelpRoutes = require('./dailyHelpRoute');
const dailyHelpAdminRoutes = require('./dailyHelpAdminRoute');
const guardRoutes = require('./guardRoutes');
const guardLogRoutes = require('./guardLogRoute');
const memberRoutes = require('./memberRoutes');
const vehicleRoutes = require('./vehicleRoute');
const petRoutes = require('./petRoute');
const maintainanceAdminRoutes = require('./maintainanceAdminRoute');
const maintainanceRoutes = require('./maintainanceRoute');
const announcementRoutes = require('./announcementRoute');
const societyRulesRoutes = require('./societyRulesRoute');
const meetingRoutes = require('./meetingRoute');
const societyInfoRoutes = require('./societyInfoRoute');
const commonRoutes = require('./commonRoute');
const notificationRoutes = require('./notificationRoute');
const feedbackRoutes = require('./feedbackRoute');
const actionReasonRoutes = require('./actionReasonRoute');


const router = express.Router();

router.use('/auth', superAdminAuthRoutes);
router.use('/userAuth', userAuthRoutes);
router.use('/society', societyRoutes);
router.use('/society-admin', societyAdminRoutes);
router.use('/system', systemRoutes);
router.use('/visitor', visitorRoutes);
router.use('/guard', guardRoutes);
router.use('/guardLog', guardLogRoutes);
router.use('/member', memberRoutes);
router.use('/vehicle', vehicleRoutes);
router.use('/pets', petRoutes);
router.use('/maintainance/admin', maintainanceAdminRoutes);
router.use('/maintainance', maintainanceRoutes);
router.use('/dailyHelp/admin', dailyHelpAdminRoutes);
router.use('/dailyHelp', dailyHelpRoutes);
router.use('/announcements', announcementRoutes);
router.use('/societyRules', societyRulesRoutes);
router.use('/meetings', meetingRoutes);
router.use('/societyInfo', societyInfoRoutes);
router.use('/common', commonRoutes);
router.use('/notifications', notificationRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/action-reasons', actionReasonRoutes);


module.exports = router;
