const { getMessaging } = require('../config/firebaseConfig');
const User = require('../model/userSchema');


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

const sendToUser = async (userId, title, body, data = {}) => {
  if (!userId) {
    return { success: false, error: 'No userId provided' };
  }

  try {
    const user = await User.findById(userId).select('fcmTokens').lean();
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      console.log(`[PushNotification] User ${userId} has no FCM tokens`);
      return { success: false, error: 'User has no FCM tokens' };
    }

    const tokens = user.fcmTokens.map((t) => t.token).filter(Boolean);
    if (tokens.length === 0) {
      return { success: false, error: 'User has no valid FCM tokens' };
    }

    return sendToMultipleDevices(tokens, title, body, data);
  } catch (error) {
    console.error('[PushNotification] Failed to send to user:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToUsers = async (userIds, title, body, data = {}) => {
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
      return { success: false, error: 'No FCM tokens found for users' };
    }

    return sendToMultipleDevices(tokens, title, body, data);
  } catch (error) {
    console.error('[PushNotification] Failed to send to users:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToSocietyMembers = async (societyId, title, body, data = {}, options = {}) => {
  if (!societyId) {
    return { success: false, error: 'No societyId provided' };
  }

  const { excludeUserIds = [], roles = ['member'] } = options;

  try {
    const query = {
      societyId,
      role: { $in: roles },
      'fcmTokens.0': { $exists: true }, 
    };

    if (excludeUserIds.length > 0) {
      query._id = { $nin: excludeUserIds };
    }

    const users = await User.find(query).select('fcmTokens').lean();

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
      return { success: false, error: 'No FCM tokens found for society members' };
    }

    console.log(`[PushNotification] Sending to ${tokens.length} tokens for society ${societyId}`);
    return sendToMultipleDevices(tokens, title, body, data);
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
  removeInvalidToken,
  removeInvalidTokens,
};
