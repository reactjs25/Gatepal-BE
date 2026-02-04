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

module.exports = router;
