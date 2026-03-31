require('dotenv').config();

const mongoose = require('mongoose');
const Notification = require('../model/notificationSchema');
const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const MemberUnit = require('../model/memberUnitSchema');
const Maintenance = require('../model/maintenanceSchema');
const Announcement = require('../model/announcementSchema');
const Meeting = require('../model/meetingSchema');
const SocietyRule = require('../model/societyRuleSchema');
const Society = require('../model/societySchema');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());

const normalizeString = (value) => (value || '').toString().trim();

const normalizeLower = (value) => normalizeString(value).toLowerCase();

const normalizeCanonicalUnitId = (value) => {
  const raw = normalizeString(value);
  if (!raw) return '';

  const parts = raw.split(':');
  if (parts.length !== 3) return '';

  const [societyId, wingNameLower, unitNumberLower] = parts;
  if (!isValidObjectId(societyId)) {
    return '';
  }

  const normalizedWing = normalizeLower(wingNameLower);
  const normalizedUnit = normalizeLower(unitNumberLower);
  if (!normalizedWing || !normalizedUnit) {
    return '';
  }

  return `${societyId}:${normalizedWing}:${normalizedUnit}`;
};

const buildCanonicalUnitId = (societyId, wingNameLower, unitNumberLower) => {
  if (!isValidObjectId(societyId)) return '';

  const normalizedWing = normalizeLower(wingNameLower);
  const normalizedUnit = normalizeLower(unitNumberLower);
  if (!normalizedWing || !normalizedUnit) return '';

  return `${String(societyId)}:${normalizedWing}:${normalizedUnit}`;
};

const buildUnitPayload = ({ wingName, wingNameLower, unitNumber, unitNumberLower }) => ({
  wingName: normalizeString(wingName),
  wingNameLower: normalizeLower(wingNameLower || wingName),
  unitNumber: normalizeString(unitNumber),
  unitNumberLower: normalizeLower(unitNumberLower || unitNumber),
});

const sameStringArray = (left = [], right = []) => {
  const leftNormalized = [...new Set(left.map((value) => normalizeString(value)).filter(Boolean))].sort();
  const rightNormalized = [...new Set(right.map((value) => normalizeString(value)).filter(Boolean))].sort();

  if (leftNormalized.length !== rightNormalized.length) {
    return false;
  }

  return leftNormalized.every((value, index) => value === rightNormalized[index]);
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const collectUnitDescriptorObjects = (data = {}) => {
  const descriptors = [];
  const pushDescriptor = (value) => {
    if (isPlainObject(value)) {
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

const parseArgs = () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : null;

  return {
    dryRun,
    limit: Number.isInteger(limit) && limit > 0 ? limit : null,
  };
};

const caches = {
  guestRequests: new Map(),
  memberUnits: new Map(),
  maintenance: new Map(),
  announcements: new Map(),
  meetings: new Map(),
  rules: new Map(),
  societyByAdmin: new Map(),
};

const getGuestEntryRequest = async (requestId) => {
  const key = normalizeString(requestId);
  if (!key) return null;
  if (!caches.guestRequests.has(key)) {
    const doc = await GuestEntryRequest.findOne(
      { requestId: key },
      { societyId: 1, wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1 }
    ).lean();
    caches.guestRequests.set(key, doc || null);
  }
  return caches.guestRequests.get(key);
};

const getMemberUnit = async (unitId) => {
  const key = normalizeString(unitId);
  if (!isValidObjectId(key)) return null;
  if (!caches.memberUnits.has(key)) {
    const doc = await MemberUnit.findById(
      key,
      { societyId: 1, wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1 }
    ).lean();
    caches.memberUnits.set(key, doc || null);
  }
  return caches.memberUnits.get(key);
};

const getMaintenance = async (maintenanceId) => {
  const key = normalizeString(maintenanceId);
  if (!key) return null;
  if (!caches.maintenance.has(key)) {
    const doc = await Maintenance.findOne(
      { maintenanceId: key },
      { unitId: 1, maintenanceId: 1, memberId: 1 }
    ).lean();
    caches.maintenance.set(key, doc || null);
  }
  return caches.maintenance.get(key);
};

const getAnnouncement = async (announcementId) => {
  const key = normalizeString(announcementId);
  if (!key) return null;
  if (!caches.announcements.has(key)) {
    const doc = await Announcement.findOne({ announcementId: key }, { societyId: 1 }).lean();
    caches.announcements.set(key, doc || null);
  }
  return caches.announcements.get(key);
};

const getMeeting = async (meetingId) => {
  const key = normalizeString(meetingId);
  if (!key) return null;
  if (!caches.meetings.has(key)) {
    const doc = await Meeting.findOne({ meetingId: key }, { societyId: 1 }).lean();
    caches.meetings.set(key, doc || null);
  }
  return caches.meetings.get(key);
};

const getRule = async (ruleId) => {
  const key = normalizeString(ruleId);
  if (!key) return null;
  if (!caches.rules.has(key)) {
    const doc = await SocietyRule.findOne({ ruleId: key }, { societyId: 1 }).lean();
    caches.rules.set(key, doc || null);
  }
  return caches.rules.get(key);
};

const getSocietyIdForAdmin = async (societyAdminId) => {
  const key = normalizeString(societyAdminId);
  if (!isValidObjectId(key)) return null;
  if (!caches.societyByAdmin.has(key)) {
    const society = await Society.findOne({ 'societyAdmins._id': key }, { _id: 1 }).lean();
    caches.societyByAdmin.set(key, society ? String(society._id) : null);
  }
  return caches.societyByAdmin.get(key);
};

const main = async () => {
  const { dryRun, limit } = parseArgs();

  await mongoose.connect(process.env.MONGO_URI);

  const query = {
    $or: [
      { societyId: null },
      { societyId: { $exists: false } },
      {
        $and: [
          {
            $or: [
              { 'data.unitId': { $exists: true } },
              { 'data.unitIds.0': { $exists: true } },
              { 'data.unit': { $exists: true } },
              { 'data.units.0': { $exists: true } },
              { 'data.unitTargets.0': { $exists: true } },
              { 'data.approvedFor.0': { $exists: true } },
              { 'data.notApprovedFor.0': { $exists: true } },
              { 'data.requestId': { $exists: true } },
              { 'data.maintenanceId': { $exists: true } },
              { 'data.canonicalUnitId': { $exists: true } },
              { 'data.canonicalUnitKey': { $exists: true } },
            ],
          },
          {
            $or: [
              { canonicalUnitIds: { $exists: false } },
              { canonicalUnitIds: { $size: 0 } },
            ],
          },
        ],
      },
    ],
  };

  let cursorQuery = Notification.find(query).sort({ createdAt: 1 }).lean();
  if (limit) {
    cursorQuery = cursorQuery.limit(limit);
  }

  const summary = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    unresolved: 0,
    dryRun,
    byType: {},
    unresolvedByType: {},
  };

  for await (const notification of cursorQuery.cursor()) {
    summary.scanned += 1;

    const data = isPlainObject(notification.data) ? notification.data : {};
    const existingCanonicalUnitIds = Array.isArray(notification.canonicalUnitIds)
      ? notification.canonicalUnitIds.map((value) => normalizeCanonicalUnitId(value)).filter(Boolean)
      : [];

    let resolvedSocietyId = isValidObjectId(notification.societyId)
      ? String(notification.societyId)
      : (isValidObjectId(data.societyId) ? String(data.societyId) : null);
    const resolvedCanonicalUnitIds = new Set(existingCanonicalUnitIds);
    let bestUnitPayload = isPlainObject(data.unit) ? buildUnitPayload(data.unit) : null;

    const addCanonicalUnitId = (value) => {
      const normalized = normalizeCanonicalUnitId(value);
      if (!normalized) return;
      resolvedCanonicalUnitIds.add(normalized);
      if (!resolvedSocietyId) {
        [resolvedSocietyId] = normalized.split(':');
      }
    };

    const registerUnitParts = ({ societyId, wingName, wingNameLower, unitNumber, unitNumberLower }) => {
      const canonicalUnitId = buildCanonicalUnitId(
        societyId || resolvedSocietyId,
        wingNameLower || wingName,
        unitNumberLower || unitNumber
      );
      if (!canonicalUnitId) return;

      addCanonicalUnitId(canonicalUnitId);
      if (!bestUnitPayload) {
        bestUnitPayload = buildUnitPayload({
          wingName,
          wingNameLower,
          unitNumber,
          unitNumberLower,
        });
      }
    };

    const registerMemberUnit = async (unitId) => {
      const normalized = normalizeString(unitId);
      if (!normalized) return;

      const canonicalFromRaw = normalizeCanonicalUnitId(normalized);
      if (canonicalFromRaw) {
        addCanonicalUnitId(canonicalFromRaw);
        return;
      }

      const unitDoc = await getMemberUnit(normalized);
      if (!unitDoc) return;

      registerUnitParts({
        societyId: unitDoc.societyId,
        wingName: unitDoc.wingName,
        wingNameLower: unitDoc.wingNameLower,
        unitNumber: unitDoc.unitNumber,
        unitNumberLower: unitDoc.unitNumberLower,
      });
    };

    addCanonicalUnitId(data.canonicalUnitId);
    addCanonicalUnitId(data.canonicalUnitKey);

    await registerMemberUnit(data.unitId);
    if (Array.isArray(data.unitIds)) {
      for (const unitId of data.unitIds) {
        await registerMemberUnit(unitId);
      }
    }

    for (const descriptor of collectUnitDescriptorObjects(data)) {
      addCanonicalUnitId(descriptor.canonicalUnitId);
      addCanonicalUnitId(descriptor.canonicalUnitKey);

      await registerMemberUnit(descriptor.unitId);
      registerUnitParts({
        societyId: descriptor.societyId || resolvedSocietyId,
        wingName: descriptor.wingName,
        wingNameLower: descriptor.wingNameLower,
        unitNumber: descriptor.unitNumber,
        unitNumberLower: descriptor.unitNumberLower,
      });
    }

    if (data.requestId) {
      const requestDoc = await getGuestEntryRequest(data.requestId);
      if (requestDoc) {
        registerUnitParts({
          societyId: requestDoc.societyId,
          wingName: requestDoc.wingName,
          wingNameLower: requestDoc.wingNameLower,
          unitNumber: requestDoc.unitNumber,
          unitNumberLower: requestDoc.unitNumberLower,
        });
      }
    }

    if (data.maintenanceId) {
      const maintenanceDoc = await getMaintenance(data.maintenanceId);
      if (maintenanceDoc) {
        await registerMemberUnit(maintenanceDoc.unitId);
      }
    }

    if (!resolvedSocietyId && data.announcementId) {
      const announcementDoc = await getAnnouncement(data.announcementId);
      if (announcementDoc?.societyId) {
        resolvedSocietyId = String(announcementDoc.societyId);
      }
    }

    if (!resolvedSocietyId && data.meetingId) {
      const meetingDoc = await getMeeting(data.meetingId);
      if (meetingDoc?.societyId) {
        resolvedSocietyId = String(meetingDoc.societyId);
      }
    }

    if (!resolvedSocietyId && data.ruleId) {
      const ruleDoc = await getRule(data.ruleId);
      if (ruleDoc?.societyId) {
        resolvedSocietyId = String(ruleDoc.societyId);
      }
    }

    if (!resolvedSocietyId && notification.societyAdminId) {
      resolvedSocietyId = await getSocietyIdForAdmin(notification.societyAdminId);
    }

    const nextCanonicalUnitIds = Array.from(resolvedCanonicalUnitIds);
    const nextData = { ...data };

    if (resolvedSocietyId && normalizeString(nextData.societyId) !== resolvedSocietyId) {
      nextData.societyId = resolvedSocietyId;
    }

    if (bestUnitPayload && !isPlainObject(nextData.unit)) {
      nextData.unit = bestUnitPayload;
    }

    const updateSet = {};
    if (resolvedSocietyId && normalizeString(notification.societyId) !== resolvedSocietyId) {
      updateSet.societyId = new mongoose.Types.ObjectId(resolvedSocietyId);
    }

    if (nextCanonicalUnitIds.length > 0 && !sameStringArray(notification.canonicalUnitIds || [], nextCanonicalUnitIds)) {
      updateSet.canonicalUnitIds = nextCanonicalUnitIds;
    }

    if (JSON.stringify(nextData) !== JSON.stringify(data)) {
      updateSet.data = nextData;
    }

    if (Object.keys(updateSet).length === 0) {
      if (!resolvedSocietyId && nextCanonicalUnitIds.length === 0) {
        summary.unresolved += 1;
        summary.unresolvedByType[notification.type || 'unknown'] =
          (summary.unresolvedByType[notification.type || 'unknown'] || 0) + 1;
      } else {
        summary.unchanged += 1;
      }
      continue;
    }

    if (!dryRun) {
      await Notification.updateOne({ _id: notification._id }, { $set: updateSet });
    }

    summary.updated += 1;
    summary.byType[notification.type || 'unknown'] = (summary.byType[notification.type || 'unknown'] || 0) + 1;
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});