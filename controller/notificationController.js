const mongoose = require('mongoose');
const Notification = require('../model/notificationSchema');
const MemberUnit = require('../model/memberUnitSchema');
const { isValidObjectId } = mongoose;
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError } = require('../utils/httpError');
const { sendToUser, sendToSocietyAdmin } = require('../utils/pushNotificationService');
const {
  normalizeLanguageCode,
  getLanguageLocale,
  getRelativeDayLabel,
  getNotificationMessage,
} = require('../utils/notificationMessages');
const { isSocietyAdminPrincipal, isScopedSocietyAdminSession } = require('../utils/adminSocietyContext');
const { assertUnitAccess, buildCanonicalUnitId, listSamePhysicalUnitIds } = require('../utils/unitAccess');

const SOCIETY_RULE_CATEGORY_LABELS = {
  general: 'General',
  parking_vehicles: 'Parking & Vehicles',
  security_safety: 'Security & Safety',
  cleanliness: 'Cleanliness',
  amenities_usage: 'Amenities Usage',
  events_celebrations: 'Events & Celebrations',
  pets_animals: 'Pets & Animals',
  construction_renovation: 'Construction & Renovation',
  maintenance: 'Maintenance',
  legal_compliance: 'Legal & Compliance',
  rent_pg: 'Rent & P.G.',
  other: 'Other',
};

const getSocietyRuleCategoryLabel = (notification = {}) => {
  const data = notification.data || {};
  const categoryKey = (data.categoryKey || '').toString().trim().toLowerCase();

  if (!categoryKey) {
    return '';
  }

  return SOCIETY_RULE_CATEGORY_LABELS[categoryKey] || data.categoryLabel || categoryKey;
};

const formatSocietyRuleNotificationData = (notification = {}) => {
  const sourceData =
    notification && notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data)
      ? notification.data
      : {};

  const categoryLabel = getSocietyRuleCategoryLabel(notification);
  if (!categoryLabel) {
    return sourceData;
  }

  const { categoryKey, categoryLabel: _existingCategoryLabel, ...restData } = sourceData;
  if (categoryKey === undefined) {
    return {
      ...restData,
      categoryLabel,
    };
  }

  return {
    categoryKey,
    categoryLabel,
    ...restData,
  };
};




const isSocietyAdmin = (req) => {
  return isSocietyAdminPrincipal(req, req.appUser);
};




const getSocietyAdminId = (req) => {
  if (!isScopedSocietyAdminSession(req, req.appUser)) {
    return null;
  }

  if (req.user?.societyAdminId) {
    return req.user.societyAdminId;
  }
  return req.appUser?.linkedSocietyAdminId || null;
};

const getRequestedSocietyId = (req) => {
  const rawSocietyId = (req.query?.societyId || req.body?.societyId || '').toString().trim();
  if (!rawSocietyId) {
    return null;
  }

  if (!isValidObjectId(rawSocietyId)) {
    throw createHttpError('Invalid societyId.', 400);
  }

  return rawSocietyId;
};

const getRequestedUnitId = (req) => {
  const rawUnitId = (req.query?.unitId || req.body?.unitId || '').toString().trim();
  if (!rawUnitId) {
    return null;
  }

  if (!isValidObjectId(rawUnitId)) {
    throw createHttpError('Invalid unitId.', 400);
  }

  return rawUnitId;
};

const getUnitlessNotificationClause = () => ({
  canonicalUnitIds: { $exists: false },
  'data.unitId': { $exists: false },
  'data.unit': { $exists: false },
  'data.units': { $exists: false },
  'data.unitTargets': { $exists: false },
  'data.approvedFor': { $exists: false },
  'data.notApprovedFor': { $exists: false },
  'data.wingName': { $exists: false },
  'data.unitNumber': { $exists: false },
});

const buildUnitFilterClauses = (unitScope, includeUnitless = false) => {
  if (!unitScope?.canonicalUnitId) {
    return [];
  }

  const clauses = [
    { canonicalUnitIds: unitScope.canonicalUnitId },
    { 'data.unit.wingName': unitScope.wingName, 'data.unit.unitNumber': unitScope.unitNumber },
    { 'data.unit.wingName': unitScope.wingNameLower, 'data.unit.unitNumber': unitScope.unitNumberLower },
    { 'data.units': { $elemMatch: { wingName: unitScope.wingName, unitNumber: unitScope.unitNumber } } },
    { 'data.units': { $elemMatch: { wingName: unitScope.wingNameLower, unitNumber: unitScope.unitNumberLower } } },
    { 'data.unitTargets': { $elemMatch: { wingName: unitScope.wingName, unitNumber: unitScope.unitNumber } } },
    { 'data.unitTargets': { $elemMatch: { wingName: unitScope.wingNameLower, unitNumber: unitScope.unitNumberLower } } },
    { 'data.approvedFor': { $elemMatch: { wingName: unitScope.wingName, unitNumber: unitScope.unitNumber } } },
    { 'data.approvedFor': { $elemMatch: { wingName: unitScope.wingNameLower, unitNumber: unitScope.unitNumberLower } } },
    { 'data.notApprovedFor': { $elemMatch: { wingName: unitScope.wingName, unitNumber: unitScope.unitNumber } } },
    { 'data.notApprovedFor': { $elemMatch: { wingName: unitScope.wingNameLower, unitNumber: unitScope.unitNumberLower } } },
    { 'data.wingName': unitScope.wingName, 'data.unitNumber': unitScope.unitNumber },
    { 'data.wingName': unitScope.wingNameLower, 'data.unitNumber': unitScope.unitNumberLower },
  ];

  if (Array.isArray(unitScope.legacyUnitIds) && unitScope.legacyUnitIds.length > 0) {
    clauses.push({ 'data.unitId': { $in: unitScope.legacyUnitIds } });
  }

  if (includeUnitless) {
    clauses.push(getUnitlessNotificationClause());
  }

  return clauses;
};

const resolveRequestedUnitScope = async (req, selectedSocietyId = null) => {
  const requestedUnitId = getRequestedUnitId(req);
  if (!requestedUnitId) {
    return null;
  }

  const unitDoc = await assertUnitAccess({ unitId: requestedUnitId, authUser: req.appUser });
  const resolvedSocietyId = String(unitDoc.societyId);

  if (selectedSocietyId && String(selectedSocietyId) !== resolvedSocietyId) {
    throw createHttpError('unitId does not belong to the selected society.', 409);
  }

  const relatedUnitIds = await listSamePhysicalUnitIds(unitDoc);
  const legacyUnitIds = relatedUnitIds.reduce((acc, unitId) => {
    const normalized = String(unitId);
    acc.push(normalized);
    if (mongoose.Types.ObjectId.isValid(normalized)) {
      acc.push(new mongoose.Types.ObjectId(normalized));
    }
    return acc;
  }, []);

  const sameUnitDocs = await MemberUnit.find(
    { _id: { $in: relatedUnitIds } },
    { memberId: 1 }
  ).lean();

  const residentUserIds = Array.from(
    new Set(
      sameUnitDocs
        .map((doc) => doc?.memberId)
        .filter(Boolean)
        .map((memberId) => String(memberId))
    )
  );

  return {
    requestedUnitId,
    societyId: resolvedSocietyId,
    canonicalUnitId: buildCanonicalUnitId(unitDoc),
    legacyUnitIds,
    residentUserIds,
    wingName: unitDoc.wingName,
    wingNameLower: unitDoc.wingNameLower,
    unitNumber: unitDoc.unitNumber,
    unitNumberLower: unitDoc.unitNumberLower,
  };
};

const formatNotificationCreatedOn = (dateValue, preferredLanguage = 'en') => {
  if (!dateValue) return '';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const tz = 'Asia/Kolkata';

  const istDateStr = (d) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const todayIST = istDateStr(now);
  const dateIST = istDateStr(date);

  const dayDiff = Math.round(
    (new Date(todayIST) - new Date(dateIST)) / (24 * 60 * 60 * 1000),
  );

  const locale = getLanguageLocale(preferredLanguage);
  const dayLabel = getRelativeDayLabel(preferredLanguage, dayDiff);
  const timePart = date.toLocaleTimeString(locale, {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (dayLabel) {
    return `${dayLabel}, ${timePart}`;
  }

  const datePart = date.toLocaleDateString(locale, {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${datePart}, ${timePart}`;
};

const buildNotificationDeduplicationKey = (notification = {}) => {
  const data = notification.data || {};
  const type = notification.type || 'general';

  if (data.requestId) {
    return `${type}:request:${String(data.requestId)}`;
  }

  if (data.announcementId) {
    return `${type}:announcement:${String(data.announcementId)}`;
  }

  if (data.meetingId) {
    return `${type}:meeting:${String(data.meetingId)}`;
  }

  if (data.ruleId) {
    return `${type}:rule:${String(data.ruleId)}`;
  }

  if (data.maintenanceId) {
    return `${type}:maintenance:${String(data.maintenanceId)}:${String(data.month || '')}:${String(data.year || '')}`;
  }

  if (data.testNotification === 'true' && data.timestamp) {
    return `${type}:test:${String(data.timestamp)}`;
  }

  return [
    type,
    notification.title || '',
    notification.body || '',
    String(notification.societyId || data.societyId || ''),
    notification.createdAt ? new Date(notification.createdAt).toISOString() : '',
  ].join('::');
};

const dedupeNotifications = (notifications = []) => {
  const grouped = new Map();

  notifications.forEach((notification) => {
    const key = buildNotificationDeduplicationKey(notification);
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...notification,
        isRead: Boolean(notification.isRead),
      });
      return;
    }

    const existing = grouped.get(key);
    existing.isRead = Boolean(existing.isRead) && Boolean(notification.isRead);
  });

  return Array.from(grouped.values());
};

const buildDeduplicatedNotificationMatch = (notification = {}) => {
  const data = notification.data || {};
  const type = notification.type || 'general';

  if (data.requestId) {
    return {
      type,
      'data.requestId': data.requestId,
    };
  }

  if (data.announcementId) {
    return {
      type,
      'data.announcementId': data.announcementId,
    };
  }

  if (data.meetingId) {
    return {
      type,
      'data.meetingId': data.meetingId,
    };
  }

  if (data.ruleId) {
    return {
      type,
      'data.ruleId': data.ruleId,
    };
  }

  if (data.maintenanceId) {
    return {
      type,
      'data.maintenanceId': data.maintenanceId,
      'data.month': data.month,
      'data.year': data.year,
    };
  }

  if (data.testNotification === 'true' && data.timestamp) {
    return {
      type,
      'data.testNotification': 'true',
      'data.timestamp': data.timestamp,
    };
  }

  return {
    type,
    title: notification.title || '',
    body: notification.body || '',
    createdAt: notification.createdAt,
    societyId: notification.societyId || data.societyId || null,
  };
};




const getNotificationQuery = (req, options = {}) => {
  const { societyId = null, unitScope = null, includeUnitlessWhenScoped = false } = options;
  const userId = req.appUser._id;
  const societyAdminId = getSocietyAdminId(req);
  const scopedResidentUserIds = Array.isArray(unitScope?.residentUserIds)
    ? unitScope.residentUserIds.filter(Boolean)
    : [];

  const recipientClauses = [];
  if (scopedResidentUserIds.length > 0) {
    recipientClauses.push({ userId: { $in: scopedResidentUserIds } });
  } else {
    recipientClauses.push({ userId });
  }

  if (societyAdminId) {
    recipientClauses.push({ societyAdminId });
  }

  const query = recipientClauses.length === 1 ? recipientClauses[0] : { $or: recipientClauses };

  if (societyId) {
    query.societyId = societyId;
  }

  if (unitScope?.requestedUnitId) {
    console.log('[NotificationAPI] Building unit-scoped query:', JSON.stringify({
      authUserId: String(userId),
      societyAdminId: societyAdminId ? String(societyAdminId) : null,
      requestedUnitId: String(unitScope.requestedUnitId),
      residentUserIds: scopedResidentUserIds,
      societyId: societyId ? String(societyId) : null,
    }));
  }

  const unitClauses = buildUnitFilterClauses(unitScope, includeUnitlessWhenScoped);
  if (unitClauses.length > 0) {
    query.$and = [...(query.$and || []), { $or: unitClauses }];
  }
  
  return query;
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const effectiveSocietyId = selectedUnitScope?.societyId || selectedSocietyId;
    const query = getNotificationQuery(req, {
      societyId: effectiveSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });

    if (req.query.isRead === 'true') {
      query.isRead = true;
    } else if (req.query.isRead === 'false') {
      query.isRead = false;
    }

    if (req.query.type) {
      query.type = req.query.type;
    }

    const unreadQuery = getNotificationQuery(req, {
      societyId: effectiveSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });
    unreadQuery.isRead = false;

    const unreadBySocietyBaseQuery = getNotificationQuery(req);
    unreadBySocietyBaseQuery.isRead = false;
    unreadBySocietyBaseQuery.societyId = { $ne: null };

    const [notifications, unreadNotifications, unreadCountsBySocietyRaw] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .lean(),
      Notification.find(unreadQuery)
        .sort({ createdAt: -1 })
        .lean(),
      Notification.aggregate([
        { $match: unreadBySocietyBaseQuery },
        { $group: { _id: '$societyId', count: { $sum: 1 } } },
      ]),
    ]);

    const notificationsForResponse = selectedUnitScope
      ? dedupeNotifications(notifications)
      : notifications;
    const unreadCount = selectedUnitScope
      ? dedupeNotifications(unreadNotifications).length
      : unreadNotifications.length;

    const unreadCountBySociety = unreadCountsBySocietyRaw.reduce((acc, row) => {
      if (!row?._id) return acc;
      acc[String(row._id)] = row.count;
      return acc;
    }, {});

    const preferredLanguage = normalizeLanguageCode(authUser.preferredLanguage || 'en');
    const formattedNotifications = notificationsForResponse.map((n) => ({
      id: String(n._id),
      title: n.title,
      body: n.body,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
      createdOn: formatNotificationCreatedOn(n.createdAt, preferredLanguage),
      data: n.type === 'society_rule' ? formatSocietyRuleNotificationData(n) : n.data || {},
    }));

    return sendSuccessResponse(res, 200, 'Notifications fetched successfully.', {
      data: formattedNotifications,
      unreadCount,
      unreadCountBySociety,
      selectedSocietyId: effectiveSocietyId,
      selectedUnitId: selectedUnitScope?.requestedUnitId || null,
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const effectiveSocietyId = selectedUnitScope?.societyId || selectedSocietyId;
    const query = getNotificationQuery(req, {
      societyId: effectiveSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });
    query.isRead = false;

    const unreadBySocietyBaseQuery = getNotificationQuery(req);
    unreadBySocietyBaseQuery.isRead = false;
    unreadBySocietyBaseQuery.societyId = { $ne: null };

    const [unreadNotifications, unreadCountsBySocietyRaw] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).lean(),
      Notification.aggregate([
        { $match: unreadBySocietyBaseQuery },
        { $group: { _id: '$societyId', count: { $sum: 1 } } },
      ]),
    ]);

    const unreadCount = selectedUnitScope
      ? dedupeNotifications(unreadNotifications).length
      : unreadNotifications.length;

    const unreadCountBySociety = unreadCountsBySocietyRaw.reduce((acc, row) => {
      if (!row?._id) return acc;
      acc[String(row._id)] = row.count;
      return acc;
    }, {});

    return sendSuccessResponse(res, 200, 'Unread count fetched successfully.', {
      data: {
        unreadCount,
        unreadCountBySociety,
        selectedSocietyId: effectiveSocietyId,
        selectedUnitId: selectedUnitScope?.requestedUnitId || null,
      },
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const baseQuery = getNotificationQuery(req, {
      societyId: selectedUnitScope?.societyId || selectedSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });

    const notification = await Notification.findOne({
      ...baseQuery,
      _id: id,
    }).lean();

    if (!notification) {
      throw createHttpError('Notification not found.', 404);
    }

    const readAt = new Date();

    if (selectedUnitScope) {
      const result = await Notification.updateMany(
        {
          ...baseQuery,
          ...buildDeduplicatedNotificationMatch(notification),
          isRead: false,
        },
        { isRead: true, readAt }
      );

      return sendSuccessResponse(res, 200, 'Notification marked as read.', {
        data: {
          id: String(notification._id),
          modifiedCount: result.modifiedCount,
          readAt,
        },
      });
    }

    const updatedNotification = await Notification.findOneAndUpdate(
      {
        ...baseQuery,
        _id: id,
      },
      { isRead: true, readAt },
      { new: true }
    );

    return sendSuccessResponse(res, 200, 'Notification marked as read.', {
      data: updatedNotification,
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const baseQuery = getNotificationQuery(req, {
      societyId: selectedUnitScope?.societyId || selectedSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });

    const readAt = new Date();
    let modifiedCount = 0;

    if (selectedUnitScope) {
      const seedNotifications = await Notification.find({
        ...baseQuery,
        _id: { $in: notificationIds },
      }).lean();

      for (const notification of seedNotifications) {
        const result = await Notification.updateMany(
          {
            ...baseQuery,
            ...buildDeduplicatedNotificationMatch(notification),
            isRead: false,
          },
          { isRead: true, readAt }
        );
        modifiedCount += result.modifiedCount;
      }
    } else {
      const result = await Notification.updateMany(
        {
          ...baseQuery,
          _id: { $in: notificationIds },
          isRead: false,
        },
        { isRead: true, readAt }
      );
      modifiedCount = result.modifiedCount;
    }

    return sendSuccessResponse(res, 200, 'Notifications marked as read.', {
      data: { modifiedCount },
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const query = getNotificationQuery(req, {
      societyId: selectedUnitScope?.societyId || selectedSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });
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

    const selectedSocietyId = getRequestedSocietyId(req);
    const selectedUnitScope = await resolveRequestedUnitScope(req, selectedSocietyId);
    const query = getNotificationQuery(req, {
      societyId: selectedUnitScope?.societyId || selectedSocietyId,
      unitScope: selectedUnitScope,
      includeUnitlessWhenScoped: Boolean(selectedUnitScope),
    });
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
