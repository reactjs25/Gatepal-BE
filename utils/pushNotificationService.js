const { getMessaging } = require('../config/firebaseConfig');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const Notification = require('../model/notificationSchema');


/**
 * Save notification to database for a single user or society admin
 */
const saveNotification = async (userId, title, body, data = {}, fcmResult = {}, options = {}) => {
  try {
    const notification = new Notification({
      userId,
      societyId: data.societyId || options.societyId || null,
      title,
      body,
      type: data.type || 'general',
      data,
      fcmStatus: fcmResult.success ? 'sent' : (fcmResult.error === 'Firebase not initialized' ? 'skipped' : 'failed'),
      fcmMessageId: fcmResult.messageId || null,
      fcmError: fcmResult.error || null,
      // Track if this is for a society admin
      isSocietyAdmin: options.isSocietyAdmin || false,
      societyAdminId: options.societyAdminId || null,
    });
    await notification.save();
    return notification;
  } catch (error) {
    console.error('[PushNotification] Failed to save notification:', error.message);
    return null;
  }
};

/**
 * Save notifications for multiple users
 */
const saveNotificationsForUsers = async (userIds, title, body, data = {}, fcmResult = {}) => {
  try {
    const notifications = userIds.map((userId) => ({
      userId,
      societyId: data.societyId || null,
      title,
      body,
      type: data.type || 'general',
      data,
      fcmStatus: fcmResult.success ? 'sent' : (fcmResult.error === 'Firebase not initialized' ? 'skipped' : 'failed'),
      fcmMessageId: fcmResult.messageId || null,
      fcmError: fcmResult.error || null,
    }));
    await Notification.insertMany(notifications);
    return notifications;
  } catch (error) {
    console.error('[PushNotification] Failed to save notifications for users:', error.message);
    return null;
  }
};

/**
 * Get FCM tokens for a society admin by admin ID
 */
const getSocietyAdminTokens = async (societyAdminId) => {
  try {
    const society = await Society.findOne(
      { 'societyAdmins._id': societyAdminId },
      { 'societyAdmins.$': 1, _id: 1 }
    ).lean();

    if (!society || !society.societyAdmins || society.societyAdmins.length === 0) {
      return { tokens: [], societyId: null };
    }

    const admin = society.societyAdmins[0];
    const tokens = (admin.fcmTokens || []).map((t) => t.token).filter(Boolean);
    return { tokens, societyId: society._id };
  } catch (error) {
    console.error('[PushNotification] Failed to get society admin tokens:', error.message);
    return { tokens: [], societyId: null };
  }
};

/**
 * Send notification to a society admin
 */
const sendToSocietyAdmin = async (societyAdminId, title, body, data = {}, options = {}) => {
  const { saveToDb = true } = options;

  if (!societyAdminId) {
    return { success: false, error: 'No societyAdminId provided' };
  }

  try {
    const { tokens, societyId } = await getSocietyAdminTokens(societyAdminId);

    if (tokens.length === 0) {
      console.log(`[PushNotification] Society admin ${societyAdminId} has no FCM tokens`);
      if (saveToDb) {
        await saveNotification(societyAdminId, title, body, data, { success: false, error: 'No FCM tokens' }, {
          isSocietyAdmin: true,
          societyAdminId,
          societyId,
        });
      }
      return { success: false, error: 'Society admin has no FCM tokens' };
    }

    const result = await sendToMultipleDevices(tokens, title, body, data);

    if (saveToDb) {
      await saveNotification(societyAdminId, title, body, data, result, {
        isSocietyAdmin: true,
        societyAdminId,
        societyId,
      });
    }

    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send to society admin:', error.message);
    return { success: false, error: error.message };
  }
};


const sendToDevice = async (token, title, body, data = {}) => {
  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[PushNotification] Firebase not initialized, skipping notification');
    return { success: false, error: 'Firebase not initialized' };
  }

  if (!token) {
    return { success: false, error: 'No token provided' };
  }

  try {
    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: Object.keys(data).reduce((acc, key) => {
        
        acc[key] = String(data[key]);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'gatepal_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await messaging.send(message);
    console.log('[PushNotification] Sent successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('[PushNotification] Failed to send:', error.message);
    
    
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await removeInvalidToken(token);
    }
    
    return { success: false, error: error.message };
  }
};


const sendToMultipleDevices = async (tokens, title, body, data = {}) => {
  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[PushNotification] Firebase not initialized, skipping notification');
    return { success: false, error: 'Firebase not initialized' };
  }

  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { success: false, error: 'No tokens provided' };
  }

  
  const validTokens = tokens.filter((t) => t && typeof t === 'string');
  if (validTokens.length === 0) {
    return { success: false, error: 'No valid tokens provided' };
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: Object.keys(data).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'gatepal_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    
    const response = await messaging.sendEachForMulticast({
      tokens: validTokens,
      ...message,
    });

    console.log(`[PushNotification] Sent ${response.successCount}/${validTokens.length} successfully`);

    
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          if (error.code === 'messaging/invalid-registration-token' ||
              error.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(validTokens[idx]);
          }
        }
      });

      
      if (invalidTokens.length > 0) {
        await removeInvalidTokens(invalidTokens);
      }
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    console.error('[PushNotification] Failed to send batch:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToTopic = async (topic, title, body, data = {}) => {
  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[PushNotification] Firebase not initialized, skipping notification');
    return { success: false, error: 'Firebase not initialized' };
  }

  if (!topic) {
    return { success: false, error: 'No topic provided' };
  }

  try {
    const message = {
      topic,
      notification: {
        title,
        body,
      },
      data: Object.keys(data).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'gatepal_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await messaging.send(message);
    console.log('[PushNotification] Sent to topic successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('[PushNotification] Failed to send to topic:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToUser = async (userId, title, body, data = {}, options = {}) => {
  const { saveToDb = true } = options;
  
  if (!userId) {
    return { success: false, error: 'No userId provided' };
  }

  try {
    const user = await User.findById(userId).select('fcmTokens').lean();
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      console.log(`[PushNotification] User ${userId} has no FCM tokens`);
      // Still save notification even if no FCM tokens
      if (saveToDb) {
        await saveNotification(userId, title, body, data, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'User has no FCM tokens' };
    }

    const tokens = user.fcmTokens.map((t) => t.token).filter(Boolean);
    if (tokens.length === 0) {
      if (saveToDb) {
        await saveNotification(userId, title, body, data, { success: false, error: 'No valid FCM tokens' });
      }
      return { success: false, error: 'User has no valid FCM tokens' };
    }

    const result = await sendToMultipleDevices(tokens, title, body, data);
    
    // Save notification to database
    if (saveToDb) {
      await saveNotification(userId, title, body, data, result);
    }
    
    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send to user:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToUsers = async (userIds, title, body, data = {}, options = {}) => {
  const { saveToDb = true } = options;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { success: false, error: 'No userIds provided' };
  }

  try {
    const users = await User.find({ _id: { $in: userIds } })
      .select('fcmTokens')
      .lean();

    const tokens = [];
    users.forEach((user) => {
      if (user.fcmTokens && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t) => {
          if (t.token) {
            tokens.push(t.token);
          }
        });
      }
    });

    if (tokens.length === 0) {
      console.log('[PushNotification] No FCM tokens found for users');
      // Still save notifications even if no FCM tokens
      if (saveToDb) {
        await saveNotificationsForUsers(userIds, title, body, data, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'No FCM tokens found for users' };
    }

    const result = await sendToMultipleDevices(tokens, title, body, data);
    
    // Save notifications for all users
    if (saveToDb) {
      await saveNotificationsForUsers(userIds, title, body, data, result);
    }
    
    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send to users:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToSocietyMembers = async (societyId, title, body, data = {}, options = {}) => {
  if (!societyId) {
    return { success: false, error: 'No societyId provided' };
  }

  const { excludeUserIds = [], roles = ['member'], saveToDb = true } = options;

  try {
    // Query all members (not just those with tokens) if we need to save notifications
    const baseQuery = {
      societyId,
      role: { $in: roles },
    };

    if (excludeUserIds.length > 0) {
      baseQuery._id = { $nin: excludeUserIds };
    }

    const users = await User.find(baseQuery).select('_id fcmTokens').lean();
    
    const userIds = users.map((u) => u._id);
    const tokens = [];
    users.forEach((user) => {
      if (user.fcmTokens && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t) => {
          if (t.token) {
            tokens.push(t.token);
          }
        });
      }
    });

    if (tokens.length === 0) {
      console.log(`[PushNotification] No FCM tokens found for society ${societyId}`);
      // Still save notifications for all members even if no FCM tokens
      if (saveToDb && userIds.length > 0) {
        await saveNotificationsForUsers(userIds, title, body, { ...data, societyId }, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'No FCM tokens found for society members' };
    }

    console.log(`[PushNotification] Sending to ${tokens.length} tokens for society ${societyId}`);
    const result = await sendToMultipleDevices(tokens, title, body, data);
    
    // Save notifications for all society members
    if (saveToDb && userIds.length > 0) {
      await saveNotificationsForUsers(userIds, title, body, { ...data, societyId }, result);
    }
    
    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send to society:', error.message);
    return { success: false, error: error.message };
  }
};

const removeInvalidToken = async (token) => {
  try {
    await User.updateMany(
      { 'fcmTokens.token': token },
      { $pull: { fcmTokens: { token } } }
    );
    console.log('[PushNotification] Removed invalid token');
  } catch (error) {
    console.error('[PushNotification] Failed to remove invalid token:', error.message);
  }
};

const removeInvalidTokens = async (tokens) => {
  try {
    await User.updateMany(
      { 'fcmTokens.token': { $in: tokens } },
      { $pull: { fcmTokens: { token: { $in: tokens } } } }
    );
    console.log(`[PushNotification] Removed ${tokens.length} invalid tokens`);
  } catch (error) {
    console.error('[PushNotification] Failed to remove invalid tokens:', error.message);
  }
};

module.exports = {
  sendToDevice,
  sendToMultipleDevices,
  sendToTopic,
  sendToUser,
  sendToUsers,
  sendToSocietyMembers,
  sendToSocietyAdmin,
  getSocietyAdminTokens,
  removeInvalidToken,
  removeInvalidTokens,
};
