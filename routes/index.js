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
const memberRoutes = require('./memberRoutes');
const vehicleRoutes = require('./vehicleRoute');
const petRoutes = require('./petRoute');
const maintainanceAdminRoutes = require('./maintainanceAdminRoute');
const maintainanceRoutes = require('./maintainanceRoute');
const announcementRoutes = require('./announcementRoute');
const societyRulesRoutes = require('./societyRulesRoute');
const meetingRoutes = require('./meetingRoute');


const router = express.Router();

router.use('/auth', superAdminAuthRoutes);
router.use('/userAuth', userAuthRoutes);
router.use('/society', societyRoutes);
router.use('/society-admin', societyAdminRoutes);
router.use('/system', systemRoutes);
router.use('/visitor', visitorRoutes);
router.use('/guard', guardRoutes);
router.use('/member', memberRoutes);
router.use('/vehicle', vehicleRoutes);
router.use('/pets', petRoutes);
router.use('/maintainance/admin', maintainanceAdminRoutes);
router.use('/maintainance', maintainanceRoutes);
router.use('/dailyHelp/admin', dailyHelpAdminRoutes);
router.use('/dailyHelp', dailyHelpRoutes);
router.use('/announcements', announcementRoutes);
router.use('/society-rules', societyRulesRoutes);
router.use('/meetings', meetingRoutes);


module.exports = router;
