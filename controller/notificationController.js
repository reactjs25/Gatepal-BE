const Notification = require('../model/notificationSchema');
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const createHttpError = require('../utils/httpError');
const { sendToUser, sendToSocietyAdmin } = require('../utils/pushNotificationService');
const {
  normalizeLanguageCode,
  getLanguageLocale,
  getRelativeDayLabel,
  getNotificationMessage,
} = require('../utils/notificationMessages');




const isSocietyAdmin = (req) => {
  
  return !!req.appUser?.linkedSocietyAdminId;
};




const getSocietyAdminId = (req) => {
  return req.appUser?.linkedSocietyAdminId;
};

const formatNotificationCreatedOn = (dateValue, preferredLanguage = 'en') => {
  if (!dateValue) return '';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const dayDiff = Math.round((startOfToday - startOfDate) / (24 * 60 * 60 * 1000));

  const locale = getLanguageLocale(preferredLanguage);
  const dayLabel = getRelativeDayLabel(preferredLanguage, dayDiff);
  const timePart = date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (dayLabel) {
    return `${dayLabel}, ${timePart}`;
  }

  const datePart = date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${datePart}, ${timePart}`;
};




const getNotificationQuery = (req) => {
  const userId = req.appUser._id;
  const societyAdminId = getSocietyAdminId(req);
  
  if (societyAdminId) {
    return { $or: [{ userId }, { societyAdminId }] };
  }
  
  return { userId };
};






const sendTestNotification = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const userLanguage = normalizeLanguageCode(authUser.preferredLanguage || 'en');
    const defaultMessage = getNotificationMessage('test_notification', {}, userLanguage);
    const { title = defaultMessage.title, body = defaultMessage.body, type = 'general' } = req.body;
    const useLocalizedTemplate = req.body.title === undefined && req.body.body === undefined;

    let result;
    let targetId;
    
    if (isSocietyAdmin(req)) {
      
      targetId = getSocietyAdminId(req);
      result = await sendToSocietyAdmin(
        targetId,
        title,
        body,
        {
          type,
          testNotification: 'true',
          timestamp: new Date().toISOString(),
        },
        useLocalizedTemplate
          ? {
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage('test_notification', {}, languageCode),
            }
          : {}
      );
    } else {
      
      targetId = authUser._id;
      result = await sendToUser(
        targetId,
        title,
        body,
        {
          type,
          testNotification: 'true',
          timestamp: new Date().toISOString(),
        },
        useLocalizedTemplate
          ? {
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage('test_notification', {}, languageCode),
            }
          : {}
      );
    }

    return sendSuccessResponse(res, 200, 'Test notification sent.', {
      data: {
        fcmResult: result,
        userId: targetId,
        isSocietyAdmin: isSocietyAdmin(req),
        title,
        body,
      },
    });
  } catch (error) {
    return next(error);
  }
};










const getNotifications = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const query = getNotificationQuery(req);

    if (req.query.isRead === 'true') {
      query.isRead = true;
    } else if (req.query.isRead === 'false') {
      query.isRead = false;
    }

    if (req.query.type) {
      query.type = req.query.type;
    }

    const unreadQuery = getNotificationQuery(req);
    unreadQuery.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .lean(),
      Notification.countDocuments(unreadQuery),
    ]);

    const preferredLanguage = normalizeLanguageCode(authUser.preferredLanguage || 'en');
    const formattedNotifications = notifications.map((n) => ({
      id: String(n._id),
      title: n.title,
      body: n.body,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
      createdOn: formatNotificationCreatedOn(n.createdAt, preferredLanguage),
      data: n.data || {},
    }));

    return sendSuccessResponse(res, 200, 'Notifications fetched successfully.', {
      data: formattedNotifications,
      unreadCount,
    });
  } catch (error) {
    return next(error);
  }
};





const getUnreadCount = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = false;

    const unreadCount = await Notification.countDocuments(query);

    return sendSuccessResponse(res, 200, 'Unread count fetched successfully.', {
      data: { unreadCount },
    });
  } catch (error) {
    return next(error);
  }
};





const markAsRead = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { id } = req.params;

    const query = getNotificationQuery(req);
    query._id = id;

    const notification = await Notification.findOneAndUpdate(
      query,
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      throw createHttpError('Notification not found.', 404);
    }

    return sendSuccessResponse(res, 200, 'Notification marked as read.', {
      data: notification,
    });
  } catch (error) {
    return next(error);
  }
};






const markMultipleAsRead = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      throw createHttpError('notificationIds array is required.', 400);
    }

    const query = getNotificationQuery(req);
    query._id = { $in: notificationIds };
    query.isRead = false;

    const result = await Notification.updateMany(
      query,
      { isRead: true, readAt: new Date() }
    );

    return sendSuccessResponse(res, 200, 'Notifications marked as read.', {
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    return next(error);
  }
};





const markAllAsRead = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = false;

    const result = await Notification.updateMany(
      query,
      { isRead: true, readAt: new Date() }
    );

    return sendSuccessResponse(res, 200, 'All notifications marked as read.', {
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    return next(error);
  }
};





const deleteNotification = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { id } = req.params;

    const query = getNotificationQuery(req);
    query._id = id;

    const notification = await Notification.findOneAndDelete(query);

    if (!notification) {
      throw createHttpError('Notification not found.', 404);
    }

    return sendSuccessResponse(res, 200, 'Notification deleted successfully.');
  } catch (error) {
    return next(error);
  }
};





const clearReadNotifications = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = true;

    const result = await Notification.deleteMany(query);

    return sendSuccessResponse(res, 200, 'Read notifications cleared.', {
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    return next(error);
  }
};

const getNotificationPreferences = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const isGuard = authUser.role === 'guard';

    return sendSuccessResponse(res, 200, 'Notification preferences fetched successfully.', {
      data: isGuard
        ? {
            notifyOnApproval: authUser.notifyOnApproval !== false,
            notifyOnDenial: authUser.notifyOnDenial !== false,
          }
        : {
            notifyOnEntry: authUser.notifyOnEntry !== false,
            notifyOnExit: authUser.notifyOnExit !== false,
          },
    });
  } catch (error) {
    return next(error);
  }
};

const updateNotificationPreferences = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const isGuard = authUser.role === 'guard';
    const {
      notifyOnEntry,
      notifyOnExit,
      notifyOnApproval,
      notifyOnDenial,
    } = req.body;

    const updates = {};
    if (isGuard) {
      if (notifyOnApproval === undefined && notifyOnDenial === undefined) {
        throw createHttpError('At least one preference (notifyOnApproval or notifyOnDenial) is required.', 400);
      }

      if (notifyOnApproval !== undefined) {
        updates.notifyOnApproval = Boolean(notifyOnApproval);
      }
      if (notifyOnDenial !== undefined) {
        updates.notifyOnDenial = Boolean(notifyOnDenial);
      }
    } else {
      if (notifyOnEntry === undefined && notifyOnExit === undefined) {
        throw createHttpError('At least one preference (notifyOnEntry or notifyOnExit) is required.', 400);
      }

      if (notifyOnEntry !== undefined) {
        updates.notifyOnEntry = Boolean(notifyOnEntry);
      }
      if (notifyOnExit !== undefined) {
        updates.notifyOnExit = Boolean(notifyOnExit);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(authUser._id, { $set: updates }, { new: true }).select(
      'notifyOnEntry notifyOnExit notifyOnApproval notifyOnDenial'
    );

    return sendSuccessResponse(res, 200, 'Notification preferences updated successfully.', {
      data: isGuard
        ? {
            notifyOnApproval: updatedUser.notifyOnApproval !== false,
            notifyOnDenial: updatedUser.notifyOnDenial !== false,
          }
        : {
            notifyOnEntry: updatedUser.notifyOnEntry !== false,
            notifyOnExit: updatedUser.notifyOnExit !== false,
          },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
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
};
