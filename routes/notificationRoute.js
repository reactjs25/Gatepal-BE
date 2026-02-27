const express = require('express');
const userAuthMiddleware = require('../middleware/userAuthMiddleware');
const {
  sendTestNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markMultipleAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  getNotificationPreferences,
  updateNotificationPreferences,
} = require('../controller/notificationController');

const router = express.Router();


router.use(userAuthMiddleware);


router.post('/test', sendTestNotification);


router.get('/', getNotifications);


router.get('/unread-count', getUnreadCount);


router.patch('/read-all', markAllAsRead);


router.patch('/read-multiple', markMultipleAsRead);


router.patch('/:id/read', markAsRead);


router.delete('/clear-read', clearReadNotifications);


router.delete('/:id', deleteNotification);

router.get('/preferences', getNotificationPreferences);
router.patch('/preferences', updateNotificationPreferences);

module.exports = router;
