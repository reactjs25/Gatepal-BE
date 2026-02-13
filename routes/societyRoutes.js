const express = require('express');
const { createSociety, getAllSociety, getSocietyById, updateSocietyById, toggleSocietyStatus, suspendSociety } = require('../controller/societyController');
const { getCountryCityOptions, getCountryFlags, getRegistrationHierarchy } = require('../controller/societyHierarchy');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/create-society', authMiddleware, createSociety);
router.get('/get-all-societies', authMiddleware, getAllSociety);
router.get('/locations/country-cities', getCountryCityOptions);
router.get('/locations/countryFlags', getCountryFlags);
router.get('/locations/registrationHierarchy', getRegistrationHierarchy);

router.get('/:id', authMiddleware, getSocietyById);
router.put('/:id', authMiddleware, updateSocietyById);
router.patch('/:id/toggle-status', authMiddleware, toggleSocietyStatus);
router.patch('/:id/suspend', authMiddleware, suspendSociety);

module.exports = router;
