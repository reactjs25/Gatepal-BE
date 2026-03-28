const mongoose = require('mongoose');
const { getMessaging } = require('../config/firebaseConfig');
const User = require('../model/userSchema');
const Society = require('../model/societySchema');
const MemberUnit = require('../model/memberUnitSchema');
const Notification = require('../model/notificationSchema');
const { normalizeLanguageCode } = require('./notificationMessages');
const { buildCanonicalUnitId } = require('./unitAccess');

const societyNameCache = new Map();

const normalizeString = (value) => (value || '').toString().trim();

const normalizeLowerString = (value) => normalizeString(value).toLowerCase();

const normalizeCanonicalUnitId = (value) => {
  const raw = normalizeString(value);
  if (!raw) return '';

  const parts = raw.split(':');
  if (parts.length !== 3) return '';

  const [societyId, wingNameLower, unitNumberLower] = parts;
  if (!mongoose.Types.ObjectId.isValid(societyId)) {
    return '';
  }

  const normalizedWing = normalizeLowerString(wingNameLower);
  const normalizedUnit = normalizeLowerString(unitNumberLower);
  if (!normalizedWing || !normalizedUnit) {
    return '';
  }

  return `${societyId}:${normalizedWing}:${normalizedUnit}`;
};

const buildCanonicalUnitIdFromParts = ({ societyId, wingName, unitNumber, wingNameLower, unitNumberLower }) => {
  const normalizedSocietyId = normalizeString(societyId);
  if (!mongoose.Types.ObjectId.isValid(normalizedSocietyId)) {
    return '';
  }

  const normalizedWing = normalizeLowerString(wingNameLower || wingName);
  const normalizedUnit = normalizeLowerString(unitNumberLower || unitNumber);
  if (!normalizedWing || !normalizedUnit) {
    return '';
  }

  return `${normalizedSocietyId}:${normalizedWing}:${normalizedUnit}`;
};

const collectUnitDescriptorObjects = (data = {}) => {
  const descriptors = [];
  const pushDescriptor = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      descriptors.push(value);
    }
  };

  pushDescriptor(data);
  pushDescriptor(data.unit);

  ['units', 'unitTargets', 'approvedFor', 'notApprovedFor'].forEach((key) => {
    if (Array.isArray(data[key])) {
      data[key].forEach(pushDescriptor);
    }
  });

  return descriptors;
};

const resolveNotificationUnitScope = async (data = {}, options = {}) => {
  const canonicalUnitIds = new Set();
  const explicitUnitIds = new Set();
  const fallbackSocietyId = normalizeString(options.societyId || data.societyId);
  let resolvedSocietyId = mongoose.Types.ObjectId.isValid(fallbackSocietyId) ? fallbackSocietyId : '';

  const addCanonical = (value) => {
    const normalized = normalizeCanonicalUnitId(value);
    if (normalized) {
      canonicalUnitIds.add(normalized);
      if (!resolvedSocietyId) {
        [resolvedSocietyId] = normalized.split(':');
      }
    }
  };

  const addExplicitUnitId = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
      return;
    }

    const canonical = normalizeCanonicalUnitId(normalized);
    if (canonical) {
      canonicalUnitIds.add(canonical);
      return;
    }

    if (mongoose.Types.ObjectId.isValid(normalized)) {
      explicitUnitIds.add(normalized);
    }
  };

  addExplicitUnitId(options.unitId);
  addExplicitUnitId(data.unitId);
  if (Array.isArray(data.unitIds)) {
    data.unitIds.forEach(addExplicitUnitId);
  }

  const descriptors = collectUnitDescriptorObjects(data);
  descriptors.forEach((descriptor) => {
    addCanonical(descriptor.canonicalUnitId);
    addCanonical(descriptor.canonicalUnitKey);
    addExplicitUnitId(descriptor.unitId);

    const descriptorSocietyId = normalizeString(descriptor.societyId || fallbackSocietyId);
    const fromParts = buildCanonicalUnitIdFromParts({
      societyId: descriptorSocietyId,
      wingName: descriptor.wingName,
      unitNumber: descriptor.unitNumber,
      wingNameLower: descriptor.wingNameLower,
      unitNumberLower: descriptor.unitNumberLower,
    });
    addCanonical(fromParts);
  });

  if (explicitUnitIds.size > 0) {
    const unitDocs = await MemberUnit.find(
      { _id: { $in: Array.from(explicitUnitIds) } },
      { societyId: 1, wingNameLower: 1, unitNumberLower: 1 }
    ).lean();

    unitDocs.forEach((unitDoc) => {
      if (!resolvedSocietyId && unitDoc?.societyId) {
        resolvedSocietyId = String(unitDoc.societyId);
      }
      addCanonical(buildCanonicalUnitId(unitDoc));
    });
  }

  return {
    societyId: resolvedSocietyId || null,
    canonicalUnitIds: Array.from(canonicalUnitIds),
  };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveSocietyName = async (data = {}, options = {}) => {
  const directName = normalizeString(options.societyName || data.societyName);
  if (directName) return directName;

  const societyIdRaw = normalizeString(options.societyId || data.societyId);
  if (!societyIdRaw || !mongoose.Types.ObjectId.isValid(societyIdRaw)) return '';

  const cacheKey = String(societyIdRaw);
  if (societyNameCache.has(cacheKey)) {
    return societyNameCache.get(cacheKey);
  }

  const society = await Society.findById(cacheKey).select('societyName').lean();
  const resolved = normalizeString(society?.societyName);
  societyNameCache.set(cacheKey, resolved);
  return resolved;
};

const appendSocietyNameToTitle = (title, societyName) => {
  const safeTitle = normalizeString(title);
  const safeSocietyName = normalizeString(societyName);
  if (!safeTitle || !safeSocietyName) return safeTitle;

  const alreadyIncludesSociety = new RegExp(`\\b${escapeRegex(safeSocietyName)}\\b`, 'i').test(safeTitle);
  if (alreadyIncludesSociety) return safeTitle;

  return `${safeTitle}, ${safeSocietyName}`;
};



const saveNotification = async (userId, title, body, data = {}, fcmResult = {}, options = {}) => {
  try {
    const unitScope = await resolveNotificationUnitScope(data, options);
    const notification = new Notification({
      userId,
      societyId: unitScope.societyId || null,
      ...(unitScope.canonicalUnitIds.length > 0 ? { canonicalUnitIds: unitScope.canonicalUnitIds } : {}),
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
    const unitScope = await resolveNotificationUnitScope(data);
    const notifications = userIds.map((userId) => ({
      userId,
      societyId: unitScope.societyId || null,
      ...(unitScope.canonicalUnitIds.length > 0 ? { canonicalUnitIds: unitScope.canonicalUnitIds } : {}),
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

const saveNotificationsForUsersWithResolvedContent = async (entries = [], data = {}) => {
  try {
    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    const unitScope = await resolveNotificationUnitScope(data);

    const notifications = entries.map((entry) => ({
      userId: entry.userId,
      societyId: unitScope.societyId || null,
      ...(unitScope.canonicalUnitIds.length > 0 ? { canonicalUnitIds: unitScope.canonicalUnitIds } : {}),
      title: entry.title,
      body: entry.body,
      type: data.type || 'general',
      data,
      fcmStatus: entry.fcmResult?.success
        ? 'sent'
        : (entry.fcmResult?.error === 'Firebase not initialized' ? 'skipped' : 'failed'),
      fcmMessageId: entry.fcmResult?.messageId || null,
      fcmError: entry.fcmResult?.error || null,
    }));

    const insertedNotifications = await Notification.insertMany(notifications);

    if (data.type === 'guest_entry_request') {
      console.log('[PushNotification] Saved guest_entry_request notifications:', JSON.stringify({
        requestId: data.requestId || null,
        recipientUserIds: entries.map((entry) => String(entry.userId)),
        societyId: unitScope.societyId || null,
        canonicalUnitIds: unitScope.canonicalUnitIds,
        notificationIds: insertedNotifications.map((notification) => String(notification._id)),
      }));
    }

    return notifications;
  } catch (error) {
    console.error('[PushNotification] Failed to save localized notifications:', error.message);
    return null;
  }
};

const resolveLocalizedContent = ({
  title,
  body,
  data = {},
  languageCode,
  localizedContentResolver,
  user = null,
}) => {
  const resolvedLanguageCode = normalizeLanguageCode(languageCode);
  if (typeof localizedContentResolver !== 'function') {
    return {
      title,
      body,
      languageCode: resolvedLanguageCode,
    };
  }

  try {
    const localized = localizedContentResolver({
      languageCode: resolvedLanguageCode,
      user,
      data,
      title,
      body,
    }) || {};

    return {
      title: localized.title || title,
      body: localized.body || body,
      languageCode: resolvedLanguageCode,
    };
  } catch (error) {
    console.error('[PushNotification] Failed to resolve localized content:', error.message);
    return {
      title,
      body,
      languageCode: resolvedLanguageCode,
    };
  }
};


const getSocietyAdminTokens = async (societyAdminId) => {
  try {
    const society = await Society.findOne(
      { 'societyAdmins._id': societyAdminId },
      { 'societyAdmins.$': 1, _id: 1 }
    ).lean();

    if (!society || !society.societyAdmins || society.societyAdmins.length === 0) {
      return { tokens: [], societyId: null, adminMobile: null };
    }

    const admin = society.societyAdmins[0];
    const tokens = (admin.fcmTokens || []).map((t) => t.token).filter(Boolean);
    return { tokens, societyId: society._id, adminMobile: admin.mobile || null };
  } catch (error) {
    console.error('[PushNotification] Failed to get society admin tokens:', error.message);
    return { tokens: [], societyId: null, adminMobile: null };
  }
};

const getPreferredLanguageByPhone = async (phoneNumber) => {
  if (!phoneNumber) {
    return 'en';
  }

  const user = await User.findOne({ phoneNumber }).select('preferredLanguage').lean();
  return normalizeLanguageCode(user?.preferredLanguage || 'en');
};


const sendToSocietyAdmin = async (societyAdminId, title, body, data = {}, options = {}) => {
  const { saveToDb = true, localizedContentResolver, languageCode } = options;

  if (!societyAdminId) {
    return { success: false, error: 'No societyAdminId provided' };
  }

  try {
    const { tokens, societyId, adminMobile } = await getSocietyAdminTokens(societyAdminId);
    const adminLanguageCode = normalizeLanguageCode(
      languageCode || await getPreferredLanguageByPhone(adminMobile)
    );
    const localizedContent = resolveLocalizedContent({
      title,
      body,
      data,
      languageCode: adminLanguageCode,
      localizedContentResolver,
    });
    const societyName = await resolveSocietyName(data, options);
    const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);
    const finalBody = localizedContent.body;

    if (tokens.length === 0) {
      console.log(`[PushNotification] Society admin ${societyAdminId} has no FCM tokens`);
      if (saveToDb) {
        await saveNotification(societyAdminId, finalTitle, finalBody, data, { success: false, error: 'No FCM tokens' }, {
          isSocietyAdmin: true,
          societyAdminId,
          societyId,
        });
      }
      return { success: false, error: 'Society admin has no FCM tokens' };
    }

    const result = await sendToMultipleDevices(tokens, finalTitle, finalBody, data);

    if (saveToDb) {
      await saveNotification(societyAdminId, finalTitle, finalBody, data, result, {
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

const getSocietyAdminTokensByPhone = async (phoneNumber) => {
  try {
    if (!phoneNumber) return [];

    const societies = await Society.find(
      { 'societyAdmins.mobile': phoneNumber },
      { societyAdmins: 1 }
    ).lean();

    if (!Array.isArray(societies) || societies.length === 0) {
      return [];
    }

    const tokenSet = new Set();
    societies.forEach((society) => {
      const admins = Array.isArray(society?.societyAdmins) ? society.societyAdmins : [];
      admins
        .filter((admin) => admin?.mobile === phoneNumber)
        .forEach((admin) => {
          const tokens = Array.isArray(admin?.fcmTokens) ? admin.fcmTokens : [];
          tokens.forEach((entry) => {
            if (entry?.token) tokenSet.add(entry.token);
          });
        });
    });

    return Array.from(tokenSet);
  } catch (error) {
    console.error('[PushNotification] Failed to get society admin tokens by phone:', error.message);
    return [];
  }
};

const sendToUser = async (userId, title, body, data = {}, options = {}) => {
  const { saveToDb = true, localizedContentResolver, languageCode } = options;
  
  if (!userId) {
    return { success: false, error: 'No userId provided' };
  }

  try {
    const user = await User.findById(userId).select('fcmTokens phoneNumber role preferredLanguage').lean();
    
    const tokens = [];
    
    
    if (user && user.fcmTokens && Array.isArray(user.fcmTokens)) {
      user.fcmTokens.forEach((t) => {
        if (t.token) {
          tokens.push(t.token);
        }
      });
    }
    
    
    if (user && user.role === 'society_admin' && user.phoneNumber) {
      const adminTokens = await getSocietyAdminTokensByPhone(user.phoneNumber);
      adminTokens.forEach((token) => {
        if (token && !tokens.includes(token)) {
          tokens.push(token);
        }
      });
    }

    const localizedContent = resolveLocalizedContent({
      title,
      body,
      data,
      languageCode: languageCode || user?.preferredLanguage || 'en',
      localizedContentResolver,
      user,
    });
    const societyName = await resolveSocietyName(data, options);
    const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);
    const finalBody = localizedContent.body;

    if (tokens.length === 0) {
      console.log(`[PushNotification] User ${userId} has no FCM tokens`);
      
      if (saveToDb) {
        await saveNotification(userId, finalTitle, finalBody, data, { success: false, error: 'No FCM tokens' });
      }
      return { success: false, error: 'User has no FCM tokens' };
    }

    const result = await sendToMultipleDevices(tokens, finalTitle, finalBody, data);
    
    if (saveToDb) {
      await saveNotification(userId, finalTitle, finalBody, data, result);
    }
    
    return result;
  } catch (error) {
    console.error('[PushNotification] Failed to send to user:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToUsers = async (userIds, title, body, data = {}, options = {}) => {
  const { saveToDb = true, localizedContentResolver } = options;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { success: false, error: 'No userIds provided' };
  }

  try {
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id fcmTokens phoneNumber role preferredLanguage')
      .lean();
    const societyName = await resolveSocietyName(data, options);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const usersWithTokens = [];

    for (const requestedUserId of userIds) {
      const user = userById.get(String(requestedUserId));
      const userTokens = [];

      if (user && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t) => {
          if (t.token) {
            userTokens.push(t.token);
          }
        });
      }

      if (user && user.role === 'society_admin' && user.phoneNumber) {
        const adminTokens = await getSocietyAdminTokensByPhone(user.phoneNumber);
        adminTokens.forEach((token) => {
          if (token && !userTokens.includes(token)) {
            userTokens.push(token);
          }
        });
      }

      usersWithTokens.push({
        userId: requestedUserId,
        user,
        tokens: userTokens,
      });
    }

    const batchGroups = new Map();
    const localizedEntries = [];

    usersWithTokens.forEach((entry) => {
      const localizedContent = resolveLocalizedContent({
        title,
        body,
        data,
        languageCode: entry.user?.preferredLanguage || 'en',
        localizedContentResolver,
        user: entry.user || null,
      });
      const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);

      const messageKey = `${localizedContent.languageCode}::${finalTitle}::${localizedContent.body}`;
      if (!batchGroups.has(messageKey)) {
        batchGroups.set(messageKey, {
          title: finalTitle,
          body: localizedContent.body,
          tokens: [],
          userIds: [],
        });
      }

      const group = batchGroups.get(messageKey);
      group.userIds.push(entry.userId);
      entry.tokens.forEach((token) => {
        if (token && !group.tokens.includes(token)) {
          group.tokens.push(token);
        }
      });
    });

    const noTokenResult = { success: false, error: 'No FCM tokens' };
    let hasAnyToken = false;
    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    for (const group of batchGroups.values()) {
      const groupResult = group.tokens.length > 0
        ? await sendToMultipleDevices(group.tokens, group.title, group.body, data)
        : noTokenResult;
      hasAnyToken = hasAnyToken || group.tokens.length > 0;
      totalSuccessCount += groupResult.successCount || 0;
      totalFailureCount += groupResult.failureCount || 0;

      group.userIds.forEach((groupUserId) => {
        localizedEntries.push({
          userId: groupUserId,
          title: group.title,
          body: group.body,
          fcmResult: groupResult,
        });
      });
    }

    if (!hasAnyToken) {
      console.log('[PushNotification] No FCM tokens found for users');
      if (saveToDb) {
        await saveNotificationsForUsersWithResolvedContent(localizedEntries, data);
      }
      return { success: false, error: 'No FCM tokens found for users' };
    }

    if (saveToDb) {
      await saveNotificationsForUsersWithResolvedContent(localizedEntries, data);
    }

    return { success: true, successCount: totalSuccessCount, failureCount: totalFailureCount };
  } catch (error) {
    console.error('[PushNotification] Failed to send to users:', error.message);
    return { success: false, error: error.message };
  }
};

const sendToSocietyMembers = async (societyId, title, body, data = {}, options = {}) => {
  if (!societyId) {
    return { success: false, error: 'No societyId provided' };
  }

  const { excludeUserIds = [], roles = ['member'], saveToDb = true, localizedContentResolver } = options;

  try {
    
    const baseQuery = {
      societyId,
      role: { $in: roles },
    };

    if (excludeUserIds.length > 0) {
      baseQuery._id = { $nin: excludeUserIds };
    }

    const users = await User.find(baseQuery).select('_id fcmTokens preferredLanguage').lean();
    const societyName = await resolveSocietyName(data, { ...options, societyId });
    const userIds = users.map((u) => u._id);
    const batchGroups = new Map();
    const localizedEntries = [];

    users.forEach((user) => {
      const localizedContent = resolveLocalizedContent({
        title,
        body,
        data,
        languageCode: user.preferredLanguage || 'en',
        localizedContentResolver,
        user,
      });
      const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);

      const messageKey = `${localizedContent.languageCode}::${finalTitle}::${localizedContent.body}`;
      if (!batchGroups.has(messageKey)) {
        batchGroups.set(messageKey, {
          title: finalTitle,
          body: localizedContent.body,
          tokens: [],
          userIds: [],
        });
      }

      const group = batchGroups.get(messageKey);
      group.userIds.push(user._id);
      if (Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t) => {
          if (t.token && !group.tokens.includes(t.token)) {
            group.tokens.push(t.token);
          }
        });
      }
    });

    const noTokenResult = { success: false, error: 'No FCM tokens' };
    let hasAnyToken = false;
    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    for (const group of batchGroups.values()) {
      const groupResult = group.tokens.length > 0
        ? await sendToMultipleDevices(group.tokens, group.title, group.body, data)
        : noTokenResult;
      hasAnyToken = hasAnyToken || group.tokens.length > 0;
      totalSuccessCount += groupResult.successCount || 0;
      totalFailureCount += groupResult.failureCount || 0;

      group.userIds.forEach((groupUserId) => {
        localizedEntries.push({
          userId: groupUserId,
          title: group.title,
          body: group.body,
          fcmResult: groupResult,
        });
      });
    }

    if (!hasAnyToken) {
      console.log(`[PushNotification] No FCM tokens found for society ${societyId}`);
      if (saveToDb && userIds.length > 0) {
        await saveNotificationsForUsersWithResolvedContent(localizedEntries, { ...data, societyId });
      }
      return { success: false, error: 'No FCM tokens found for society members' };
    }

    if (saveToDb && userIds.length > 0) {
      await saveNotificationsForUsersWithResolvedContent(localizedEntries, { ...data, societyId });
    }
    
    return { success: true, successCount: totalSuccessCount, failureCount: totalFailureCount };
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
    await Society.updateMany(
      { 'societyAdmins.fcmTokens.token': token },
      { $pull: { 'societyAdmins.$[].fcmTokens': { token } } }
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
    await Society.updateMany(
      { 'societyAdmins.fcmTokens.token': { $in: tokens } },
      { $pull: { 'societyAdmins.$[].fcmTokens': { token: { $in: tokens } } } }
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
    localizedContentResolver,
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
      .select('_id fcmTokens preferredLanguage')
      .lean();
    const societyName = await resolveSocietyName(enrichedData, params);
    const batchGroups = new Map();
    const localizedEntries = [];

    users.forEach((user) => {
      const localizedContent = resolveLocalizedContent({
        title,
        body,
        data: enrichedData,
        languageCode: user.preferredLanguage || 'en',
        localizedContentResolver,
        user,
      });
      const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);

      const messageKey = `${localizedContent.languageCode}::${finalTitle}::${localizedContent.body}`;
      if (!batchGroups.has(messageKey)) {
        batchGroups.set(messageKey, {
          title: finalTitle,
          body: localizedContent.body,
          tokens: [],
          userIds: [],
        });
      }

      const group = batchGroups.get(messageKey);
      group.userIds.push(user._id);
      if (Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach((t) => {
          if (t.token && !group.tokens.includes(t.token)) {
            group.tokens.push(t.token);
          }
        });
      }
    });

    let finalResult = { success: false, error: 'No FCM tokens found' };
    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    for (const group of batchGroups.values()) {
      const groupResult = group.tokens.length > 0
        ? await sendToMultipleDevices(group.tokens, group.title, group.body, enrichedData, { iconUrl, imageUrl })
        : { success: false, error: 'No FCM tokens found' };

      if (groupResult.success) {
        finalResult = { success: true };
      }
      totalSuccessCount += groupResult.successCount || 0;
      totalFailureCount += groupResult.failureCount || 0;

      group.userIds.forEach((groupUserId) => {
        localizedEntries.push({
          userId: groupUserId,
          title: group.title,
          body: group.body,
          fcmResult: groupResult,
        });
      });
    }

    await saveNotificationsForUsersWithResolvedContent(localizedEntries, {
      ...enrichedData,
      societyName,
      iconUrl,
      imageUrl,
    });

    if (finalResult.success) {
      return { ...finalResult, successCount: totalSuccessCount, failureCount: totalFailureCount };
    }
    return finalResult;
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
    localizedContentResolver,
    languageCode,
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
    const { tokens, adminMobile } = await getSocietyAdminTokens(societyAdminId);
    const adminLanguageCode = normalizeLanguageCode(
      languageCode || await getPreferredLanguageByPhone(adminMobile)
    );
    const localizedContent = resolveLocalizedContent({
      title,
      body,
      data: enrichedData,
      languageCode: adminLanguageCode,
      localizedContentResolver,
    });
    const societyName = await resolveSocietyName(enrichedData, params);
    const finalTitle = appendSocietyNameToTitle(localizedContent.title, societyName);
    const finalBody = localizedContent.body;

    let result;
    if (tokens.length === 0) {
      console.log(`[PushNotification] Society admin ${societyAdminId} has no FCM tokens for scheduled notification`);
      result = { success: false, error: 'No FCM tokens found' };
    } else {
      result = await sendToMultipleDevices(tokens, finalTitle, finalBody, enrichedData, { iconUrl, imageUrl });
    }

   
    await saveNotification(societyAdminId, finalTitle, finalBody, {
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
