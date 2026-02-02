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

// All routes require authentication
router.use(userAuthMiddleware);

// Send a test notification (for development/testing)
router.post('/test', sendTestNotification);

// Get notifications with pagination and filters
router.get('/', getNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Mark all as read
router.patch('/read-all', markAllAsRead);

// Mark multiple as read
router.patch('/read-multiple', markMultipleAsRead);

// Mark single notification as read
router.patch('/:id/read', markAsRead);

// Clear all read notifications
router.delete('/clear-read', clearReadNotifications);

// Delete single notification
router.delete('/:id', deleteNotification);

module.exports = router;
