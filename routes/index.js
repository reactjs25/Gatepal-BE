const express = require('express');
const superAdminAuthRoutes = require('./authRoutes');
const userAuthRoutes = require('./userAuthRoutes');
const societyRoutes = require('./societyRoutes');
const societyAdminRoutes = require('./societyAdminRoutes');
const systemRoutes = require('./systemRoutes');

const router = express.Router();

router.use('/auth', superAdminAuthRoutes);
router.use('/user-auth', userAuthRoutes);
router.use('/society', societyRoutes);
router.use('/society-admin', societyAdminRoutes);
router.use('/system', systemRoutes);

module.exports = router;

