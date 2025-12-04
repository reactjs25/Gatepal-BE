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
router.use('/dailyHelp/admin', dailyHelpAdminRoutes);
router.use('/dailyHelp', dailyHelpRoutes);


module.exports = router;
