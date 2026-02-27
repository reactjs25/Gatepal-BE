const express = require('express');
const {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncementById,
  deleteAnnouncementById,
} = require('../controller/society/announcementController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/', userAuthMiddleware, createAnnouncement)
router.get('/', userAuthMiddleware, getAnnouncements);
router.get('/single', userAuthMiddleware, getAnnouncementById);
router.patch('/', userAuthMiddleware, updateAnnouncementById);
router.delete('/', userAuthMiddleware, deleteAnnouncementById);

module.exports = router;

