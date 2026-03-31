const buildUnitlessNotificationClause = () => ({
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
    clauses.push(buildUnitlessNotificationClause());
  }

  return clauses;
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

const buildNotificationQuery = ({
  userId,
  societyAdminId = null,
  societyId = null,
  unitScope = null,
  includeUnitlessWhenScoped = false,
}) => {
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

  const unitClauses = buildUnitFilterClauses(unitScope, includeUnitlessWhenScoped);
  if (unitClauses.length > 0) {
    query.$and = [...(query.$and || []), { $or: unitClauses }];
  }

  return query;
};

module.exports = {
  buildUnitFilterClauses,
  buildNotificationDeduplicationKey,
  dedupeNotifications,
  buildNotificationQuery,
};
