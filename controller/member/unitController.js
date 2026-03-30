const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const FamilyMember = require('../../model/familyMemberSchema');
const Vehicle = require('../../model/vehicleSchema');
const Pet = require('../../model/petSchema');
const Announcement = require('../../model/announcementSchema');
const Meeting = require('../../model/meetingSchema');
const SocietyRule = require('../../model/societyRuleSchema');
const Maintenance = require('../../model/maintenanceSchema');
const Notification = require('../../model/notificationSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { toCanonicalOccupantType, toCanonicalOccupancyStatus, mapUiToCanonicalOccupancy } = require('../../utils/enums/memberEnums');
const { assertUnitAccess, buildCanonicalUnitId, listSamePhysicalUnitIds } = require('../../utils/unitAccess');
const { toISTDateLabel, toISTTimeLabel } = require('../../utils/dateTime');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { isScopedSocietyAdminSession } = require('../../utils/adminSocietyContext');

const OCCUPANT_TYPES = new Set([
  'unit_owner',
  'unit_owner_family_member',
  'tenant',
  'tenant_family_member',
]);

const OCCUPANCY_STATUSES = new Set(['currently_residing', 'unit_rented', 'unit_vacant']);
const mongoose = require('mongoose');

const UI_OCCUPANCY_ALLOWED = new Set([
  'owner_is_residing',
  'unit_is_empty',
  'unit_is_rented_out',
]);

const isMemberOrSocietyAdmin = (authUser) =>
  authUser && (authUser.role === 'member' || authUser.role === 'society_admin');


const validateMemberUnitPayload = (payload = {}) => {
  const city = normalizeString(payload.city);
  const societyName = normalizeString(payload.societyName);
  const societyPin = normalizeString(payload.societyPin);

  const wingName = normalizeString(payload.wingName ?? payload.wing);
  const unitNumber = normalizeString(payload.unitNumber ?? payload.unnitNumber ?? payload.unit);

  const rawOccupantType = payload.occupantType ?? payload.occupancyType ?? payload.occupanytype;
  const occupantType = toCanonicalOccupantType(rawOccupantType);
  let occupancyStatus = toCanonicalOccupancyStatus(payload.occupancyStatus);

  if (!societyPin) {
    throw createHttpError('societyPin is required.', 400);
  }

  if (!wingName || !unitNumber) {
    throw createHttpError('wingName and unitNumber are required.', 400);
  }

  if (!occupantType) {
    throw createHttpError(
      'occupantType must be one of unit_owner, unit_owner_family_member, tenant, tenant_family_member.',
      400
    );
  }

  if (!occupancyStatus && (occupantType === 'tenant' || occupantType === 'tenant_family_member')) {
    occupancyStatus = 'unit_rented';
  }

  if (!occupancyStatus) {
    throw createHttpError(
      'occupancyStatus must be one of currently_residing, unit_rented, unit_vacant.',
      400
    );
  }

  return { city, societyName, societyPin, wingName, unitNumber, occupantType, occupancyStatus };
};

const findWingAndUnit = (society, wingName, unitNumber) => {
  const wings = Array.isArray(society.structure) ? society.structure : [];
  const wing = wings.find((w) => w?.wingName && w.wingName.trim().toLowerCase() === wingName.toLowerCase());
  if (!wing) return { wing: null, unit: null };
  const units = Array.isArray(wing.units) ? wing.units : [];
  const unit = units.find((u) => u?.unitNumber && u.unitNumber.trim().toLowerCase() === unitNumber.toLowerCase());
  return { wing, unit };
};

const addMemberUnit = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const { city, societyName, societyPin, wingName, unitNumber, occupantType, occupancyStatus } =
      validateMemberUnitPayload(req.body || {});

    if (!isMemberOrSocietyAdmin(authUser)) {
      return next(createHttpError('Only members can add units to their account.', 403));
    }

    const targetUser = authUser;

    let society = await Society.findOne({ societyPin: societyPin }).lean();
    if (!society) {
      const nameFilter = societyName ? { societyName: societyName } : {};
      const cityFilter = city ? { city: city } : {};
      society = await Society.findOne({ ...nameFilter, ...cityFilter }).lean();
    }
    if (!society) {
      return next(createHttpError('Society not found for provided details.', 404));
    }
    if (societyPin && normalizeString(society.societyPin) !== societyPin) {
      return next(createHttpError('Provided societyPin does not match selected society.', 400));
    }

    const { wing, unit } = findWingAndUnit(society, wingName, unitNumber);
    if (!wing) {
      return next(createHttpError('Wing not found in the member’s society.', 404));
    }
    if (!unit) {
      return next(createHttpError('Unit not found in the specified wing.', 404));
    }

    const primaryOwner = await MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType: 'unit_owner',
    })
      .sort({ createdAt: 1 })
      .lean();

    const primaryTenant = await MemberUnit.findOne({
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType: 'tenant',
    }).lean();

    if (occupantType === 'tenant') {
      if (primaryTenant) {
        return next(createHttpError('A tenant is already registered for this unit.', 409));
      }
    }

    const exists = await MemberUnit.exists({
      memberId: targetUser._id,
      societyId: society._id,
      wingNameLower: wingName.toLowerCase(),
      unitNumberLower: unitNumber.toLowerCase(),
    });

    if (exists) {
      return next(createHttpError('This unit has already been added for the member.', 409));
    }

    const payload = {
      memberId: targetUser._id,
      societyId: society._id,
      wingName,
      wingNameLower: wingName.toLowerCase(),
      unitNumber,
      unitNumberLower: unitNumber.toLowerCase(),
      occupantType,
      occupancyStatus,
      ...(occupantType === 'unit_owner_family_member' && primaryOwner
        ? { primaryMemberId: primaryOwner.memberId }
        : {}),
      ...(occupantType === 'tenant_family_member' && primaryTenant
        ? { primaryMemberId: primaryTenant.memberId }
        : {}),
    };

    const doc = await MemberUnit.create(payload);

    return sendSuccessResponse(res, 201, 'Unit added successfully.', {
      data: {
        id: doc._id,
        societyName: society.societyName,
        societyPin: society.societyPin,
        city: society.city,
        country: society.country,
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        memberName: targetUser.fullName || null,
        nextStep: 'home',
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add unit for member'));
  }
};

const updateUnitOccupancyStatus = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isMemberOrSocietyAdmin(authUser)) {
      return next(createHttpError('Only members can update unit occupancy status.', 403));
    }

    const unitId = normalizeString(req.params.id || req.params.unit_id || '');
    const incomingStatus = normalizeString(req.body.occupancy_status);

    if (!unitId) {
      return next(createHttpError('unit_id is required.', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit_id.', 400));
    }

    if (!incomingStatus) {
      return next(createHttpError('occupancy_status is required.', 400));
    }

    if (!UI_OCCUPANCY_ALLOWED.has(incomingStatus)) {
      return next(
        createHttpError(
          'occupancy_status must be one of owner_is_residing, unit_is_empty, unit_is_rented_out.',
          400
        )
      );
    }

    const canonical = mapUiToCanonicalOccupancy(incomingStatus);

    if (!canonical || !OCCUPANCY_STATUSES.has(canonical)) {
      return next(createHttpError('Invalid occupancy status value.', 400));
    }

    const doc = await MemberUnit.findById(unitId);

    if (!doc) {
      return next(createHttpError('Unit not found.', 404));
    }

    if (String(doc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit.', 403));
    }

    doc.occupancyStatus = canonical;
    await doc.save();

    const society = await Society.findById(doc.societyId).lean();

    return sendSuccessResponse(res, 200, 'Occupancy status updated successfully.', {
      data: {
        id: String(doc._id),
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        societyName: society ? society.societyName : undefined,
        societyPin: society ? society.societyPin : undefined,
        city: society ? society.city : undefined,
        country: society ? society.country : undefined,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update unit occupancy status'));
  }
};

const getUnitById = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const unitId = normalizeString(req.params.id || '');

    if (!unitId) {
      return next(createHttpError('unitId path parameter is required.', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return next(createHttpError('Invalid unit ID format.', 400));
    }

    const doc = await MemberUnit.findById(unitId);

    if (!doc) {
      return next(createHttpError('Unit not found.', 404));
    }

    if (String(doc.memberId) !== String(authUser._id)) {
      return next(createHttpError('Forbidden: you do not own this unit.', 403));
    }

    const society = await Society.findById(doc.societyId).lean();
    const member = await User.findById(doc.memberId).lean();

    return sendSuccessResponse(res, 200, 'Unit details fetched successfully.', {
      data: {
        id: String(doc._id),
        memberName: member ? member.fullName || null : null,
        wingName: doc.wingName,
        unitNumber: doc.unitNumber,
        occupantType: doc.occupantType,
        occupancyStatus: doc.occupancyStatus,
        society: society
          ? {
            id: String(society._id),
            name: society.societyName,
            pin: society.societyPin,
            address: society.address,
            city: society.city,
            country: society.country,
          }
          : null,

        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch unit details'));
  }
};

const getUnitDashboard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const unitIdCandidate = normalizeString(
      (req.body && req.body.unitId) ||
      (req.params && (req.params.unitId || req.params.id)) ||
      (req.query && (req.query.unitId || req.query.id)) ||
      ''
    );
    if (!unitIdCandidate) {
      return next(createHttpError('unitId is required.', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitAccess({ unitId: unitIdCandidate, authUser });
    } catch (e) {
      return next(e);
    }

    const canonicalUnitId = buildCanonicalUnitId(unitDoc);
    const societyId = unitDoc.societyId;
  const samePhysicalUnitIds = await listSamePhysicalUnitIds(unitDoc);
    const isSocietyAdminSession = isScopedSocietyAdminSession(req, authUser);
    const isSameSocietyAdminContext =
      isSocietyAdminSession && req.user?.societyId && String(req.user.societyId) === String(societyId);

    let societyAdminId = isSocietyAdminSession ? (req.user?.societyAdminId || authUser.linkedSocietyAdminId || null) : null;
    if (isSocietyAdminSession && !societyAdminId) {
      const adminMatches = await lookupSocietyAdminsByMobile(authUser.phoneNumber || '');
      const matchedForUnitSociety = adminMatches.find(
        (match) => String(match.societyId) === String(societyId)
      );
      if (matchedForUnitSociety?.adminId) {
        societyAdminId = matchedForUnitSociety.adminId;
      }
    }
    
    const [familyRecordCount, sameUnitDocs, vehicleCount, petCount, announcementDocs, meetingDocs, ruleDocs, maintenanceDocs, userNotificationCount, adminNotificationCount] = await Promise.all([
      FamilyMember.countDocuments({ unitId: { $in: samePhysicalUnitIds } }),
      MemberUnit.find(
        { _id: { $in: samePhysicalUnitIds } },
        { _id: 1, memberId: 1 }
      ).lean(),
      Vehicle.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
      Pet.countDocuments({ unitId: canonicalUnitId, deletedAt: null }),
      Announcement.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
      Meeting.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
      SocietyRule.find({ societyId, deletedAt: null }).lean(),
      Maintenance.find({ unitId: canonicalUnitId, deletedAt: null }).lean(),
      Notification.countDocuments({ userId: authUser._id, isRead: false, societyId }),
      societyAdminId ? Notification.countDocuments({ societyAdminId, isRead: false, societyId }) : Promise.resolve(0),
    ]);

    const sameUnitResidentIds = new Set(
      sameUnitDocs
        .map((doc) => (doc?.memberId ? String(doc.memberId) : null))
        .filter((memberId) => memberId && memberId !== String(authUser._id))
    );
    const familyCount = familyRecordCount + sameUnitResidentIds.size;

    const unreadNotificationCount = userNotificationCount + adminNotificationCount;

    const addedItems = [familyCount > 0, vehicleCount > 0, petCount > 0].filter(Boolean).length;
    const progressPercent = Math.round((addedItems / 3) * 100);

    const toValidTimestamp = (value) => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      const ts = d.getTime();
      return Number.isNaN(ts) ? null : ts;
    };

    const readAnnouncementIdsSet = new Set(
      Array.isArray(authUser.readAnnouncementIds)
        ? authUser.readAnnouncementIds.map((id) => String(id))
        : []
    );
    const readMeetingIdsSet = new Set(
      Array.isArray(authUser.readMeetingIds)
        ? authUser.readMeetingIds.map((id) => String(id))
        : []
    );
    const lastMeetingsSeenAtTs = toValidTimestamp(authUser.lastMeetingsSeenAt);
    const lastRulesSeenByCategoryTs = {};
    const rawRulesSeen = authUser.lastSocietyRulesSeenAtByCategory || {};
    if (rawRulesSeen && typeof rawRulesSeen === 'object') {
      Object.keys(rawRulesSeen).forEach((key) => {
        const ts = toValidTimestamp(rawRulesSeen[key]);
        if (ts) lastRulesSeenByCategoryTs[key] = ts;
      });
    }

    const unreadAnnouncementCount = announcementDocs.reduce((count, doc) => {
      const id = doc && doc.announcementId ? String(doc.announcementId) : '';
      if (!id) return count + 1;
      return readAnnouncementIdsSet.has(id) ? count : count + 1;
    }, 0);

    const unreadMeetingCount = meetingDocs.reduce((count, doc) => {
      const id = doc && doc.meetingId ? String(doc.meetingId) : '';
      if (!id) return count + 1;
      return readMeetingIdsSet.has(id) ? count : count + 1;
    }, 0);

    const unreadSocietyRulesCount = ruleDocs.reduce((count, doc) => {
      const createdAt = doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
      const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(doc.updatedAt) : null;
      const effectiveAt = updatedAt || createdAt;
      if (!effectiveAt) return count;
      const key = doc.categoryKey || '__uncategorized__';
      const lastSeenTs = lastRulesSeenByCategoryTs[key] || 0;
      if (!lastSeenTs) return count + 1;
      return effectiveAt.getTime() > lastSeenTs ? count + 1 : count;
    }, 0);

    const announcementCount = unreadAnnouncementCount;
    const meetingCount = unreadMeetingCount;
    const society_rules = unreadSocietyRulesCount;

    const recentAnnouncement = announcementDocs[0] || null;
    let recent_announcement = null;
    if (recentAnnouncement) {
      const announcementDate = recentAnnouncement.createdAt instanceof Date
        ? recentAnnouncement.createdAt
        : new Date(recentAnnouncement.createdAt);
      const formattedDate = toISTDateLabel(announcementDate);

      const contentPreview = recentAnnouncement.contentHtml
        .replace(/<[^>]*>/g, '')
        .substring(0, 100)
        .trim();

      recent_announcement = {
        id: 'recent_announcement',
        title: recentAnnouncement.title || 'Recent Announcement',
        description: recentAnnouncement.contentHtml || `<p>${contentPreview || 'New announcement from society.'}</p>`,
        severity: 'success',
        ctaLabel: 'View Details',
        titleIcon: '/assets/announcement 1.png',
        ctaLabelIcon: '/assets/view_details.png',
      };
    }

    const now = new Date();
    let upcomingMeeting = null;
    let society_meeting = null;

    const upcomingMeetings = [];
    for (const meeting of meetingDocs) {
      const meetingDateStr = meeting.meetingDate ? meeting.meetingDate.toString().trim() : '';
      const meetingTimeStr = meeting.meetingStartingFrom ? meeting.meetingStartingFrom.toString().trim() : '';
      if (meetingDateStr && meetingTimeStr) {
        const combinedDateTime = new Date(`${meetingDateStr} ${meetingTimeStr}`);
        if (combinedDateTime > now && !Number.isNaN(combinedDateTime.getTime())) {
          upcomingMeetings.push({ meeting, dateTime: combinedDateTime });
        }
      }
    }

    if (upcomingMeetings.length > 0) {
      upcomingMeetings.sort((a, b) => a.dateTime - b.dateTime);
      upcomingMeeting = upcomingMeetings[0].meeting;
    }

    if (upcomingMeeting) {
      const meetingDateStr = upcomingMeeting.meetingDate ? upcomingMeeting.meetingDate.toString().trim() : '';
      const meetingTimeStr = upcomingMeeting.meetingStartingFrom ? upcomingMeeting.meetingStartingFrom.toString().trim() : '';
      const combinedDateTime = new Date(`${meetingDateStr} ${meetingTimeStr}`);
      const formattedDate = toISTDateLabel(combinedDateTime);
      const formattedTime = toISTTimeLabel(combinedDateTime);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[combinedDateTime.getDay()];

      const venue = upcomingMeeting.venue || 'society hall';
      const agendaPreview = upcomingMeeting.agendaHtml
        .replace(/<[^>]*>/g, '')
        .substring(0, 80)
        .trim();

      society_meeting = {
        id: 'meeting',
        title: 'Upcoming society meeting',
        description: upcomingMeeting.agendaHtml
          || `<p>General meeting of society will be held on ${formattedDate}, ${dayName} at ${formattedTime} in ${venue}. ${agendaPreview ? `${agendaPreview}...` : 'All members are requested to attend.'}</p>`,
        severity: 'success',
        ctaLabel: 'View Details',
        titleIcon: '/assets/society_icon.png',
        ctaLabelIcon: '/assets/view_details.png',
      };
    }

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonthIndex = currentDate.getMonth();
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const currentMonth = MONTH_NAMES[currentMonthIndex];

    const currentMonthMaintenance = maintenanceDocs.find(
      (m) => m.year === currentYear && m.month === currentMonth
    );

    const verifiedMaintenance = maintenanceDocs.find(
      (m) => m.year === currentYear && m.month === currentMonth && m.status === 'Verified'
    );

    let Maintenance_proof = null;
    
    if (!verifiedMaintenance) {
      if (currentMonthMaintenance && currentMonthMaintenance.status === 'Rejected') {
        Maintenance_proof = {
          id: 'maintenance_due',
          title: 'Upload Maintenance Proof',
          description: `Your maintenance proof for ${currentMonth} ${currentYear} was rejected. Please upload a new proof.`,
          severity: 'warning',
          ctaLabel: 'Upload Now',
          titleIcon: '/assets/maintainance.png',
          ctaLabelIcon: '/assets/upload.png',
        };
      } 
      else if (currentMonthMaintenance && currentMonthMaintenance.status === 'Uploaded') {
        Maintenance_proof = {
          id: 'maintenance_due',
          title: 'Maintenance Proof Pending',
          description: `Your maintenance proof for ${currentMonth} ${currentYear} is pending verification. Please wait for admin approval.`,
          severity: 'info',
          ctaLabel: 'View Status',
          titleIcon: '/assets/maintainance.png',
          ctaLabelIcon: '/assets/view_details.png',
        };
      }
      else {
        const lastDayOfMonth = new Date(currentYear, currentMonthIndex + 1, 0);
        const daysRemaining = Math.max(0, Math.ceil((lastDayOfMonth - currentDate) / (1000 * 60 * 60 * 24)));

        Maintenance_proof = {
          id: 'maintenance_due',
          title: 'Upload Maintenance Proof',
          description: `${daysRemaining} days left to pay maintenance for ${currentMonth} ${currentYear}. Upload maintenance proof on or before ${toISTDateLabel(lastDayOfMonth)}.`,
          severity: 'warning',
          ctaLabel: 'Upload Now',
          titleIcon: '/assets/maintainance.png',
          ctaLabelIcon: '/assets/upload.png',
        };
      }
    }

    const access_expire = {
      id: 'access_expire',
      title: 'App access is expiring in 3 months.',
      description:
        'Your GatePal app access is about to expire in 3 months, please renew your contract to continue using the app.',
      severity: 'warning',
      ctaLabel: 'Please contact your our support team.',
      titleIcon: '/assets/access_expire.png',
      ctaLabelIcon: '/assets/contact_support.png',
    };

    const completeProfile = {
      progressPercent,
      items: {
        familyMember: {
          label: 'Family Member',
          added: familyCount > 0,
          count: familyCount,
          statusLabel: familyCount > 0 ? 'Added' : 'Add Now',
        },
        vehicles: {
          label: 'Vehicles',
          added: vehicleCount > 0,
          count: vehicleCount,
          statusLabel: vehicleCount > 0 ? 'Added' : 'Add Now',
        },
        pets: {
          label: 'Pets',
          added: petCount > 0,
          count: petCount,
          statusLabel: petCount > 0 ? 'Added' : 'Add Now',
        },
      },
    };

    const shouldShowCompleteProfile = addedItems < 3;

    const unit = {
      id: String(unitDoc._id),
      wingName: unitDoc.wingName,
      unitNumber: unitDoc.unitNumber,
    };

    const society = {
      announcementCount,
      meetingCount,
      society_rules,
      notificationCount: unreadNotificationCount,
    };

    const cards = [
      {
        unit,
      },
      {
        society,
      },
      ...(shouldShowCompleteProfile ? [{
        actionCardType: 'completeProfile',
        completeProfile,
      }] : []),
      {
        recent_announcement: 'announcement',
        announcement: [
          ...(society_meeting ? [{
            actionCardType: 'upcomingMeeting',
            society_meeting: [society_meeting],
          }] : []),
          ...(Maintenance_proof ? [{
            actionCardType: 'uploadMaintenanceProof',
            Maintenance_proof: [Maintenance_proof],
          }] : []),
          ...(isSameSocietyAdminContext ? [{
            actionCardType: 'accessExpiring',
            access_expire: [access_expire],
          }] : []),
          ...(recent_announcement ? [{
            actionCardType: 'announcement',
            recent_announcement: [recent_announcement],
          }] : []),
        ],
      },
    ];

    return sendSuccessResponse(res, 200, 'Unit dashboard fetched successfully.', {

      data: cards,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch unit dashboard'));
  }
};

module.exports = {
  addMemberUnit,
  validateMemberUnitPayload,
  updateUnitOccupancyStatus,
  getUnitById,
  getUnitDashboard,
};
