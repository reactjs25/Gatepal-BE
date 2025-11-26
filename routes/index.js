const express = require('express');
const superAdminAuthRoutes = require('./authRoutes');
const userAuthRoutes = require('./userAuthRoutes');
const societyRoutes = require('./societyRoutes');
const societyAdminRoutes = require('./societyAdminRoutes');
const systemRoutes = require('./systemRoutes');
const visitorRoutes = require('./visitorRoute');
const guardRoutes = require('./guardRoutes');

const router = express.Router();

router.use('/auth', superAdminAuthRoutes);
router.use('/userAuth', userAuthRoutes);
router.use('/society', societyRoutes);
router.use('/society-admin', societyAdminRoutes);
router.use('/system', systemRoutes);
router.use('/visitor', visitorRoutes);
router.use('/guard', guardRoutes);

module.exports = router;

