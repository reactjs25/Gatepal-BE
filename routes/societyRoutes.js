const express = require('express');
const { createSociety, getAllSociety, getSocietyById, updateSocietyById, toggleSocietyStatus } = require('../controller/societyController');
const { getCountryCityOptions, getRegistrationHierarchy } = require('../controller/societyHierarchy');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/create-society', authMiddleware, createSociety);
router.get('/get-all-societies', authMiddleware, getAllSociety);
router.get('/locations/country-cities', getCountryCityOptions);
router.get('/locations/registrationHierarchy', getRegistrationHierarchy);

router.get('/:id', authMiddleware, getSocietyById);
router.put('/:id', authMiddleware, updateSocietyById);
router.patch('/:id/toggle-status', authMiddleware, toggleSocietyStatus);

module.exports = router;
