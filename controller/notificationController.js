const Notification = require('../model/notificationSchema');
const { sendSuccessResponse } = require('../utils/response');
const createHttpError = require('../utils/httpError');
const { sendToUser, sendToSocietyAdmin } = require('../utils/pushNotificationService');




const isSocietyAdmin = (req) => {
  
  return !!req.appUser?.linkedSocietyAdminId;
};




const getSocietyAdminId = (req) => {
  return req.appUser?.linkedSocietyAdminId;
};




const getNotificationQuery = (req) => {
  if (isSocietyAdmin(req)) {
    
    return { societyAdminId: getSocietyAdminId(req) };
  }
  
  return { userId: req.appUser._id };
};






const sendTestNotification = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized', 401);
    }

    const { title = 'Test Notification', body = 'This is a test push notification from GatePal!', type = 'general' } = req.body;

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
        }
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
        }
      );
    }

    return sendSuccessResponse(res, 200, 'Test notification sent', {
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
      throw createHttpError('Unauthorized', 401);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

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

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments(unreadQuery),
    ]);

    return sendSuccessResponse(res, 200, 'Notifications fetched successfully', {
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + notifications.length < total,
      },
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
      throw createHttpError('Unauthorized', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = false;

    const unreadCount = await Notification.countDocuments(query);

    return sendSuccessResponse(res, 200, 'Unread count fetched successfully', {
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
      throw createHttpError('Unauthorized', 401);
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
      throw createHttpError('Notification not found', 404);
    }

    return sendSuccessResponse(res, 200, 'Notification marked as read', {
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
      throw createHttpError('Unauthorized', 401);
    }

    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      throw createHttpError('notificationIds array is required', 400);
    }

    const query = getNotificationQuery(req);
    query._id = { $in: notificationIds };
    query.isRead = false;

    const result = await Notification.updateMany(
      query,
      { isRead: true, readAt: new Date() }
    );

    return sendSuccessResponse(res, 200, 'Notifications marked as read', {
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
      throw createHttpError('Unauthorized', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = false;

    const result = await Notification.updateMany(
      query,
      { isRead: true, readAt: new Date() }
    );

    return sendSuccessResponse(res, 200, 'All notifications marked as read', {
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
      throw createHttpError('Unauthorized', 401);
    }

    const { id } = req.params;

    const query = getNotificationQuery(req);
    query._id = id;

    const notification = await Notification.findOneAndDelete(query);

    if (!notification) {
      throw createHttpError('Notification not found', 404);
    }

    return sendSuccessResponse(res, 200, 'Notification deleted successfully');
  } catch (error) {
    return next(error);
  }
};





const clearReadNotifications = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized', 401);
    }

    const query = getNotificationQuery(req);
    query.isRead = true;

    const result = await Notification.deleteMany(query);

    return sendSuccessResponse(res, 200, 'Read notifications cleared', {
      data: { deletedCount: result.deletedCount },
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
};
