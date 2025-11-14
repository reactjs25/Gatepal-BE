const express = require('express');
const {
  createSociety,
  getAllSociety,
  getSocietyById,
  updateSocietyById,
  toggleSocietyStatus,

} = require('../controller/societyController');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/create-society', authMiddleware, createSociety);
router.get('/get-all-societies', authMiddleware, getAllSociety);
router.get('/:id', authMiddleware, getSocietyById);
router.put('/:id', authMiddleware, updateSocietyById);
router.patch('/:id/toggle-status', authMiddleware, toggleSocietyStatus);

module.exports = router;