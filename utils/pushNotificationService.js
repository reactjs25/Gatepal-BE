const { getMessaging } = require('../config/firebaseConfig');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const Notification = require('../model/notificationSchema');



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


const getSocietyAdminTokens = async (societyAdminId) => {
  try {
    console.log(`[getSocietyAdminTokens] Looking for admin with _id: ${societyAdminId}`);
    
    const society = await Society.findOne(
      { 'societyAdmins._id': societyAdminId },
      { 'societyAdmins.$': 1, _id: 1 }
    ).lean();

    console.log(`[getSocietyAdminTokens] Society found:`, society ? 'yes' : 'no');

    if (!society || !society.societyAdmins || society.societyAdmins.length === 0) {
      console.log(`[getSocietyAdminTokens] No society or admin found`);
      return { tokens: [], societyId: null };
    }

    const admin = society.societyAdmins[0];
    console.log(`[getSocietyAdminTokens] Admin found:`, {
      _id: admin._id,
      name: admin.name,
      fcmTokensCount: admin.fcmTokens?.length || 0,
      fcmTokens: admin.fcmTokens,
    });
    
    const tokens = (admin.fcmTokens || []).map((t) => t.token).filter(Boolean);
    return { tokens, societyId: society._id };
  } catch (error) {
    console.error('[PushNotification] Failed to get society admin tokens:', error.message);
    return { tokens: [], societyId: null };
  }
};


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


const sendToMultipleDevices = async (tokens, title, body, data = {}, options = {}) => {
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

  const { iconUrl, imageUrl } = options;

  try {
    const notification = {
      title,
      body,
    };

    if (imageUrl) {
      notification.imageUrl = imageUrl;
    }

    const message = {
      notification,
      data: Object.keys(data).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'gatepal_notifications',
          ...(iconUrl && { icon: iconUrl }),
          ...(imageUrl && { imageUrl }),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
          },
        },
        fcmOptions: {
          ...(imageUrl && { image: imageUrl }),
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
    const user = await User.findById(userId).select('fcmTokens linkedSocietyAdminId').lean();
    
    const tokens = [];
    
    // Get tokens from User record
    if (user && user.fcmTokens && Array.isArray(user.fcmTokens)) {
      user.fcmTokens.forEach((t) => {
        if (t.token) {
          tokens.push(t.token);
        }
      });
    }
    
    // If user is also a society admin, get tokens from Society collection
    if (user && user.linkedSocietyAdminId) {
      const { tokens: adminTokens } = await getSocietyAdminTokens(user.linkedSocietyAdminId);
      adminTokens.forEach((token) => {
        if (token && !tokens.includes(token)) {
          tokens.push(token);
        }
      });
    }

    if (tokens.length === 0) {
      console.log(`[PushNotification] User ${userId} has no FCM tokens`);
      
      if (saveToDb) {
        await saveNotification(userId, title, body, data, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'User has no FCM tokens' };
    }

    const result = await sendToMultipleDevices(tokens, title, body, data);
    
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

  console.log(`[PushNotification] sendToUsers called with userIds:`, userIds);
  console.log(`[PushNotification] Title: "${title}", Body: "${body}"`);

  try {
    const users = await User.find({ _id: { $in: userIds } })
      .select('fcmTokens fullName role linkedSocietyAdminId')
      .lean();

    console.log(`[PushNotification] Found ${users.length} users:`, users.map(u => ({
      id: u._id,
      name: u.fullName,
      role: u.role,
      linkedSocietyAdminId: u.linkedSocietyAdminId,
      fcmTokenCount: u.fcmTokens?.length || 0,
    })));

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

   
    const societyAdminIds = users
      .filter((u) => u.linkedSocietyAdminId)
      .map((u) => u.linkedSocietyAdminId);

    if (societyAdminIds.length > 0) {
      console.log(`[PushNotification] Found ${societyAdminIds.length} linked society admin(s):`, societyAdminIds);
      
      for (const adminId of societyAdminIds) {
        const { tokens: adminTokens } = await getSocietyAdminTokens(adminId);
        console.log(`[PushNotification] Society admin ${adminId} has ${adminTokens.length} tokens`);
        
        adminTokens.forEach((token) => {
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        });
      }
      
      console.log(`[PushNotification] After adding society admin tokens: ${tokens.length} total tokens`);
    }

    console.log(`[PushNotification] Collected ${tokens.length} FCM tokens`);

    if (tokens.length === 0) {
      console.log('[PushNotification] No FCM tokens found for users');
      
      if (saveToDb) {
        await saveNotificationsForUsers(userIds, title, body, data, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'No FCM tokens found for users' };
    }

    const result = await sendToMultipleDevices(tokens, title, body, data);
    
    
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
      
      if (saveToDb && userIds.length > 0) {
        await saveNotificationsForUsers(userIds, title, body, { ...data, societyId }, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'No FCM tokens found for society members' };
    }

    console.log(`[PushNotification] Sending to ${tokens.length} tokens for society ${societyId}`);
    const result = await sendToMultipleDevices(tokens, title, body, data);
    
    
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


const sendScheduledNotification = async (params) => {
  const {
    userIds,
    title,
    body,
    type,
    data = {},
    societyId,
    societyName,
    iconUrl = '/assets/Logo.png',
    imageUrl,
  } = params;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { success: false, error: 'No userIds provided' };
  }

  const enrichedData = {
    ...data,
    type,
    societyId: societyId ? String(societyId) : '',
    societyName: societyName || '',
  };

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

    let result;
    if (tokens.length === 0) {
      console.log('[PushNotification] No FCM tokens found for scheduled notification');
      result = { success: false, error: 'No FCM tokens found' };
    } else {
      result = await sendToMultipleDevices(tokens, title, body, enrichedData, { iconUrl, imageUrl });
    }

    
    await saveNotificationsForUsers(userIds, title, body, {
      ...enrichedData,
      societyName,
      iconUrl,
      imageUrl,
    }, result);

    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send scheduled notification:', error.message);
    return { success: false, error: error.message };
  }
};


const sendScheduledAdminNotification = async (params) => {
  const {
    societyAdminId,
    title,
    body,
    type,
    data = {},
    societyId,
    societyName,
    iconUrl = '/assets/Logo.png',
    imageUrl,
  } = params;

  if (!societyAdminId) {
    return { success: false, error: 'No societyAdminId provided' };
  }

  const enrichedData = {
    ...data,
    type,
    societyId: societyId ? String(societyId) : '',
    societyName: societyName || '',
  };

  try {
    const { tokens } = await getSocietyAdminTokens(societyAdminId);

    let result;
    if (tokens.length === 0) {
      console.log(`[PushNotification] Society admin ${societyAdminId} has no FCM tokens for scheduled notification`);
      result = { success: false, error: 'No FCM tokens found' };
    } else {
      result = await sendToMultipleDevices(tokens, title, body, enrichedData, { iconUrl, imageUrl });
    }

   
    await saveNotification(societyAdminId, title, body, {
      ...enrichedData,
      societyName,
      iconUrl,
      imageUrl,
    }, result, {
      isSocietyAdmin: true,
      societyAdminId,
      societyId,
    });

    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send scheduled admin notification:', error.message);
    return { success: false, error: error.message };
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
  sendScheduledNotification,
  sendScheduledAdminNotification,
  removeInvalidToken,
  removeInvalidTokens,
};
