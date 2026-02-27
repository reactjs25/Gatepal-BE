const express = require('express');
const {
  createMeeting,
  getMeetings,
  getMeetingById,
  updateMeetingById,
  updateMeetingDiscussionById,
  deleteMeetingById,
} = require('../controller/society/meetingController');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');

const router = express.Router();

router.post('/', userAuthMiddleware, createMeeting);
router.get('/', userAuthMiddleware, getMeetings);
router.get('/single', userAuthMiddleware, getMeetingById);
router.patch('/', userAuthMiddleware, updateMeetingById);
router.post('/discussion', userAuthMiddleware, updateMeetingDiscussionById);
router.patch('/discussion', userAuthMiddleware, updateMeetingDiscussionById);
router.delete('/', userAuthMiddleware, deleteMeetingById);

module.exports = router;
