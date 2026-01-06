const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const FamilyMember = require('../../model/familyMemberSchema');
const Vehicle = require('../../model/vehicleSchema');
const Pet = require('../../model/petSchema');
const Announcement = require('../../model/announcementSchema');
const Meeting = require('../../model/meetingSchema');
const SocietyRule = require('../../model/societyRuleSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
const { normalizeString } = require('../../utils/strings');
const { assertUnitResidentAccess } = require('../../utils/unitAccess');
const { toISTDateTimeLabel } = require('../../utils/dateTime');

const resolveAdminSociety = async (authUser) => {
    if (!authUser) throw createHttpError('Unauthorized', 401);
    if (authUser.adminSocietyId) {
        const society = await Society.findById(authUser.adminSocietyId).lean();
        if (!society) throw createHttpError('Society not found', 404);
        return society;
    }
    const linkedId = authUser.linkedSocietyAdminId || null;
    if (linkedId) {
        const society = await Society.findOne({ 'societyAdmins._id': linkedId }).lean();
        if (!society) throw createHttpError('Society not found', 404);
        return society;
    }
    const match = await lookupSocietyAdminByMobile(authUser.phoneNumber || '');
    if (!match) throw createHttpError('Society not found', 404);
    const society = await Society.findById(match.societyId).lean();
    if (!society) throw createHttpError('Society not found', 404);
    return society;
};

const classifyUnitGroup = (items) => {
    const types = new Set(items.map((x) => x.occupantType));
    const statuses = new Set(items.map((x) => x.occupancyStatus));
    if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) {
        return 'tenant';
    }
    if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) {
        return 'vacant';
    }
    if (types.has('unit_owner') || types.has('unit_owner_family_member')) {
        return 'owner';
    }
    return 'owner';
};

const buildCreatedAndUpdatedOn = (doc) => {
    if (!doc) {
        return {
            createdOn: '',
            updatedOn: '',
        };
    }

    const createdAt =
        doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
    const updatedAt =
        doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(doc.updatedAt) : null;

    const createdOn = createdAt ? toISTDateTimeLabel(createdAt) : '';

    let updatedOn = '';
    if (createdAt && updatedAt && updatedAt.getTime() !== createdAt.getTime()) {
        updatedOn = toISTDateTimeLabel(updatedAt);
    }

    return {
        createdOn,
        updatedOn,
    };
};

const getSocietyInfo = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) {
            return next(createHttpError('Unauthorized', 401));
        }

        if (authUser.role !== 'society_admin' && !authUser.linkedSocietyAdminId && !authUser.adminSocietyId) {
            return next(createHttpError('Only society admins can perform this action', 403));
        }

        const society = await resolveAdminSociety(authUser);

        const wings = Array.isArray(society.structure) ? society.structure : [];
        const totalUnits = wings.reduce((sum, w) => {
            const units = Array.isArray(w.units) ? w.units.length : 0;
            const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
            return sum + (declared || units);
        }, 0);

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
        ).lean();

        const unitGroups = occupants.reduce((acc, u) => {
            const key = `${u.wingNameLower}:${u.unitNumberLower}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(u);
            return acc;
        }, {});

        const groupKeys = Object.keys(unitGroups);

        let ownerUnitCount = 0;
        let tenantUnitCount = 0;
        let vacantUnitCount = 0;

        groupKeys.forEach((key) => {
            const items = unitGroups[key] || [];
            const kind = classifyUnitGroup(items);
            if (kind === 'owner') ownerUnitCount += 1;
            else if (kind === 'tenant') tenantUnitCount += 1;
            else if (kind === 'vacant') vacantUnitCount += 1;
        });

        const notRegisteredCount = Math.max(0, totalUnits - groupKeys.length);

        const unitsSummary = {
            title: 'Units List',
            totalUnits,
            ownerResiding: ownerUnitCount,
            tenantResiding: tenantUnitCount,
            vacant: vacantUnitCount,
            notRegisteredOnGatePal: notRegisteredCount,
        };

        const unitList = [];

        wings.forEach((wing) => {
            const wingName = wing.wingName;
            const units = Array.isArray(wing.units) ? wing.units : [];
            units.forEach((u) => {
                const unitNumber = u.unitNumber;
                const wingLower = (wingName || '').toString().toLowerCase();
                const unitLower = (unitNumber || '').toString().toLowerCase();
                const key = `${wingLower}:${unitLower}`;
                const items = unitGroups[key] || [];
                const kind = items.length > 0 ? classifyUnitGroup(items) : null;
                const occupancyCategory = kind || 'not_registered';
                let statusLabel = 'Not Registered on GatePal\u2122';
                if (occupancyCategory === 'owner') statusLabel = 'Owner Residing';
                else if (occupancyCategory === 'tenant') statusLabel = 'Tenant Residing';
                else if (occupancyCategory === 'vacant') statusLabel = 'Vacant';
                unitList.push({
                    wingName,
                    unitNumber,
                    occupancyCategory,
                    statusLabel,
                });
            });
        });

        const structuralKeys = new Set(
            unitList.map((u) => `${(u.wingName || '').toString().toLowerCase()}:${(u.unitNumber || '').toString().toLowerCase()}`)
        );

        groupKeys.forEach((key) => {
            if (!structuralKeys.has(key)) {
                const items = unitGroups[key] || [];
                if (!items.length) return;
                const primary = items[0];
                const kind = classifyUnitGroup(items);
                const occupancyCategory = kind || 'owner';
                let statusLabel = 'Owner Residing';
                if (occupancyCategory === 'tenant') statusLabel = 'Tenant Residing';
                else if (occupancyCategory === 'vacant') statusLabel = 'Vacant';
                const wingName = primary.wingName;
                const unitNumber = primary.unitNumber;
                unitList.push({
                    wingName,
                    unitNumber,
                    occupancyCategory,
                    statusLabel,
                });
            }
        });

        const unitObjectIdMap = occupants.reduce((acc, u) => {
            const key = String(u._id);
            if (!acc[key]) {
                acc[key] = {
                    wingName: u.wingName,
                    unitNumber: u.unitNumber,
                    occupantType: u.occupantType,
                };
            }
            return acc;
        }, {});

        const unitIdMap = occupants.reduce((acc, u) => {
            const canonical = `${String(society._id)}:${u.wingNameLower}:${u.unitNumberLower}`;
            if (!acc[canonical]) {
                acc[canonical] = {
                    wingName: u.wingName,
                    unitNumber: u.unitNumber,
                };
            }
            return acc;
        }, {});

        const unitIds = occupants.map((u) => u._id);

        const familyMembers = unitIds.length
            ? await FamilyMember.find({ unitId: { $in: unitIds } }).lean()
            : [];

        const totalResidents = familyMembers.length;
        let adults = 0;
        let children = 0;
        familyMembers.forEach((fm) => {
            if (fm.category === 'adult') adults += 1;
            else if (fm.category === 'child') children += 1;
        });

        const residentsSummary = {
            title: 'Residents',
            totalResidents,
            adults,
            children,
        };

        const residents = familyMembers.map((fm) => {
            const unitInfo = unitObjectIdMap[String(fm.unitId)] || {};
            const unitNumber = unitInfo.unitNumber || null;
            return {
                id: String(fm._id),
                name: fm.name,
                category: fm.category,
                unitNumber: unitNumber || null,
                occupantType: unitInfo.occupantType || null,
                imageUrl: fm.imageUrl || null,
            };
        });

        const prefix = `${String(society._id)}:`;

        const vehicles = await Vehicle.find({ unitId: { $regex: `^${prefix}` }, deletedAt: null }).lean();

        let twoWheelerCount = 0;
        let fourWheelerCount = 0;
        let otherVehicleCount = 0;
        vehicles.forEach((v) => {
            if (v.vehicleType === 'Two-Wheeler') twoWheelerCount += 1;
            else if (v.vehicleType === 'Four-Wheeler') fourWheelerCount += 1;
            else if (v.vehicleType === 'Other') otherVehicleCount += 1;
        });

        const vehiclesSummary = {
            title: 'Vehicles',
            twoWheeler: twoWheelerCount,
            fourWheeler: fourWheelerCount,
            others: otherVehicleCount,
        };

        const vehiclesList = vehicles.map((v) => {
            const unitInfo = unitIdMap[v.unitId] || {};
            const wingName = unitInfo.wingName || null;
            const unitNumber = unitInfo.unitNumber || null;
            return {
                id: String(v._id),
                vehicleNumber: v.vehicleNumber,
                vehicleType: v.vehicleType,
                unitNumber: unitNumber || null,
            };
        });

        const pets = await Pet.find({ unitId: { $regex: `^${prefix}` }, deletedAt: null }).lean();

        let dogs = 0;
        let cats = 0;
        let parrots = 0;
        let otherPets = 0;
        pets.forEach((p) => {
            if (p.petType === 'Dog') dogs += 1;
            else if (p.petType === 'Cat') cats += 1;
            else if (p.petType === 'Parrot') parrots += 1;
            else otherPets += 1;
        });

        // Only send non-zero/non-null counts to frontend
        const petsSummary = {
            title: 'Pets',
            ...(dogs ? { dogs } : {}),
            ...(cats ? { cats } : {}),
            ...(parrots ? { parrots } : {}),
            ...(otherPets ? { others: otherPets } : {}),
        };

        const petsList = pets.map((p) => {
            const unitInfo = unitIdMap[p.unitId] || {};
            const wingName = unitInfo.wingName || null;
            const unitNumber = unitInfo.unitNumber || null;
            return {
                id: String(p._id),
                name: p.name,
                petType: p.petType,
                unitNumber: unitNumber || null,
                vaccinationStatus: p.vaccinationStatus,
            };
        });

        const missingUnits = unitList
            .filter((u) => u.occupancyCategory === 'not_registered')
            .map((u) => {
                const unitNumber = (u.unitNumber || '').toString().trim();
                return {
                    unitNumber: unitNumber || null,
                    status: 'Not Registered',
                };
            });

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            unitsSummary,
            residentsSummary,
            vehiclesSummary,
            petsSummary,
            units: unitList,
            residents,
            vehicles: vehiclesList,
            pets: petsList,
            missingUnits,
        };

        return sendSuccessResponse(res, 200, 'Society info fetched successfully', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society info'));
    }
};

const getSocietyActivitySummary = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) {
            return next(createHttpError('Unauthorized', 401));
        }

        const viewAsRaw = normalizeString(
            (req.body && req.body.viewAs) ||
            (req.params && req.params.viewAs) ||
            (req.query && req.query.viewAs) ||
            ''
        );
        const viewAs = viewAsRaw.toLowerCase();
        const isMemberView = authUser.role === 'member' || viewAs === 'member';

        let societyId = null;
        if (
            (authUser.adminSocietyId || authUser.linkedSocietyAdminId || authUser.role === 'society_admin') &&
            !isMemberView
        ) {
            const society = await resolveAdminSociety(authUser);
            societyId = society._id;
        } else if (isMemberView) {
            const unitIdCandidate = normalizeString(
                (req.body && req.body.unitId) ||
                (req.params && (req.params.unitId || req.params.id)) ||
                (req.query && (req.query.unitId || req.query.id)) ||
                ''
            );

            if (!unitIdCandidate) {
                return next(createHttpError('unitId is required to view society activity summary', 400));
            }

            let unitDoc;
            try {
                unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
            } catch (e) {
                return next(e);
            }

            societyId = unitDoc.societyId;
        } else {
            return next(createHttpError('Only members or society admins can perform this action', 403));
        }

        const society = await Society.findById(societyId).lean();
        if (!society) {
            return next(createHttpError('Society not found', 404));
        }

        const [announcementDocs, meetingDocs, ruleDocs] = await Promise.all([
            Announcement.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
            Meeting.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
            SocietyRule.find({ societyId, deletedAt: null }).lean(),
        ]);

        let lastAnnouncementsSeenAtTs = null;
        let lastMeetingsSeenAtTs = null;
        let lastRulesSeenByCategoryTs = {};

        if (isMemberView) {
            if (authUser.lastAnnouncementsSeenAt) {
                const lastAnnouncementsSeenAt =
                    authUser.lastAnnouncementsSeenAt instanceof Date
                        ? authUser.lastAnnouncementsSeenAt
                        : new Date(authUser.lastAnnouncementsSeenAt);
                if (!Number.isNaN(lastAnnouncementsSeenAt.getTime())) {
                    lastAnnouncementsSeenAtTs = lastAnnouncementsSeenAt.getTime();
                }
            }

            if (authUser.lastMeetingsSeenAt) {
                const lastMeetingsSeenAt =
                    authUser.lastMeetingsSeenAt instanceof Date
                        ? authUser.lastMeetingsSeenAt
                        : new Date(authUser.lastMeetingsSeenAt);
                if (!Number.isNaN(lastMeetingsSeenAt.getTime())) {
                    lastMeetingsSeenAtTs = lastMeetingsSeenAt.getTime();
                }
            }

            const rawRulesSeen = authUser.lastSocietyRulesSeenAtByCategory || {};
            if (rawRulesSeen && typeof rawRulesSeen === 'object') {
                Object.keys(rawRulesSeen).forEach((key) => {
                    const value = rawRulesSeen[key];
                    const date = value instanceof Date ? value : value ? new Date(value) : null;
                    if (date && !Number.isNaN(date.getTime())) {
                        lastRulesSeenByCategoryTs[key] = date.getTime();
                    }
                });
            }
        }

        let unreadAnnouncementsCount = 0;
        const announcementItems = [];
        announcementDocs.forEach((doc) => {
            const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);
            const createdAt =
                doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
            let isRead = true;
            if (isMemberView) {
                if (lastAnnouncementsSeenAtTs && createdAt) {
                    isRead = createdAt.getTime() <= lastAnnouncementsSeenAtTs;
                } else {
                    isRead = true;
                }
            }
            if (!isRead) {
                unreadAnnouncementsCount += 1;
            }
            announcementItems.push({
                announcementId: doc.announcementId,
                societyId: String(doc.societyId),
                title: doc.title,
                contentHtml: doc.contentHtml,
                photos: Array.isArray(doc.photos) ? doc.photos : [],
                attachments: doc.attachments || [],
                createdOn,
                updatedOn,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                isRead,
            });
        });

        let unreadMeetingsCount = 0;
        const upcomingMeetings = [];
        const pastMeetings = [];
        const now = new Date();

        meetingDocs.forEach((doc) => {
            const meetingDateStr = doc.meetingDate ? doc.meetingDate.toString().trim() : '';
            const meetingTimeStr = doc.meetingStartingFrom ? doc.meetingStartingFrom.toString().trim() : '';
            const combinedDateTime = meetingDateStr && meetingTimeStr ? new Date(`${meetingDateStr} ${meetingTimeStr}`) : null;
            const isUpcoming = combinedDateTime && combinedDateTime > now;

            const createdAt =
                doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;

            let isRead = true;
            if (isMemberView) {
                if (lastMeetingsSeenAtTs && createdAt) {
                    isRead = createdAt.getTime() <= lastMeetingsSeenAtTs;
                } else {
                    isRead = true;
                }
            }
            if (!isRead) {
                unreadMeetingsCount += 1;
            }

            const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);
            const payload = {
                meetingId: doc.meetingId,
                societyId: String(doc.societyId),
                meetingDate: doc.meetingDate,
                meetingStartingFrom: doc.meetingStartingFrom,
                venue: doc.venue,
                agendaHtml: doc.agendaHtml,
                agendaPhotos: Array.isArray(doc.agendaPhotos) ? doc.agendaPhotos : [],
                agendaAttachments: doc.agendaAttachments || [],
                discussionHtml: doc.discussionHtml || '',
                discussionPhotos: Array.isArray(doc.discussionPhotos) ? doc.discussionPhotos : [],
                discussionAttachments: doc.discussionAttachments || [],
                createdOn,
                updatedOn,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                isRead,
            };

            if (isUpcoming) {
                upcomingMeetings.push(payload);
            } else {
                pastMeetings.push(payload);
            }
        });

        let unreadSocietyRulesCount = 0;
        const rulesWithMeta = [];

        ruleDocs.forEach((doc) => {
            const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);
            const createdAt =
                doc.createdAt instanceof Date ? doc.createdAt : doc.createdAt ? new Date(doc.createdAt) : null;
            const updatedAt =
                doc.updatedAt instanceof Date ? doc.updatedAt : doc.updatedAt ? new Date(doc.updatedAt) : null;
            const effectiveAt = updatedAt || createdAt;

            let isRead = true;
            if (isMemberView && effectiveAt) {
                const key = doc.categoryKey;
                const lastSeenTs = lastRulesSeenByCategoryTs[key] || 0;
                const effectiveTs = effectiveAt.getTime();
                if (!lastSeenTs || effectiveTs > lastSeenTs) {
                    isRead = false;
                }
            }
            if (!isRead) {
                unreadSocietyRulesCount += 1;
            }

            rulesWithMeta.push({
                ruleId: doc.ruleId,
                societyId: String(doc.societyId),
                categoryKey: doc.categoryKey,
                contentHtml: doc.contentHtml,
                photos: Array.isArray(doc.photos) ? doc.photos : [],
                attachments: doc.attachments || [],
                createdOn,
                updatedOn,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                effectiveAt,
                isRead,
            });
        });

        rulesWithMeta.sort((a, b) => {
            const aTime = a.effectiveAt instanceof Date ? a.effectiveAt.getTime() : 0;
            const bTime = b.effectiveAt instanceof Date ? b.effectiveAt.getTime() : 0;
            return bTime - aTime;
        });

        const recentAnnouncements = announcementItems.slice(0, 10);
        const recentUpcomingMeetings = upcomingMeetings.slice(0, 10);
        const recentPastMeetings = pastMeetings.slice(0, 10);
        const recentSocietyRules = rulesWithMeta.slice(0, 10).map((item) => {
            const { effectiveAt, ...rest } = item;
            return rest;
        });

        const recentMeetings = [...recentUpcomingMeetings, ...recentPastMeetings];

        const data = {
            societyId: String(societyId),
            societyName: society.societyName,
            unreadCounts: {
                announcementCount: unreadAnnouncementsCount,
                meetingCount: unreadMeetingsCount,
                society_rules: unreadSocietyRulesCount,
            },
            announcements: recentAnnouncements,
            meetings: recentMeetings,
            societyRules: recentSocietyRules,
        };

        return sendSuccessResponse(res, 200, 'Society activity summary fetched successfully', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society activity summary'));
    }
};

module.exports = {
    getSocietyInfo,
    getSocietyActivitySummary,
};

