const mongoose = require('mongoose');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const FamilyMember = require('../../model/familyMemberSchema');
const User = require('../../model/userSchema');
const Vehicle = require('../../model/vehicleSchema');
const Pet = require('../../model/petSchema');
const Maintenance = require('../../model/maintenanceSchema');
const DailyHelpAssignment = require('../../model/dailyHelpAssignmentSchema');
const Announcement = require('../../model/announcementSchema');
const Meeting = require('../../model/meetingSchema');
const SocietyRule = require('../../model/societyRuleSchema');
const MissingUnitRequest = require('../../model/missingUnitRequestSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { assertUnitResidentAccess, buildCanonicalUnitId } = require('../../utils/unitAccess');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const {
    isSocietyAdminPrincipal,
    resolveAdminSocietyFromContext,
} = require('../../utils/adminSocietyContext');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { assertSocietyIsAccessible } = require('../../utils/societyAccess');

const assertSocietyInfoAccess = (req, authUser) => {
    if (!authUser) {
        throw createHttpError('Unauthorized.', 401);
    }

    const effectiveRole = req?.user?.effectiveRole || authUser.role;
    const isSocietyAdmin = isSocietyAdminPrincipal(req, authUser);
    const isGuard = effectiveRole === 'guard';
    const isMember = effectiveRole === 'member';

    if (!isSocietyAdmin && !isGuard && !isMember) {
        throw createHttpError('Only society admins, guards, or members can perform this action.', 403);
    }
};

const resolveSocietyForSocietyInfo = async (authUser, req) => {
    if (!authUser) throw createHttpError('Unauthorized.', 401);
    const effectiveRole = req?.user?.effectiveRole || authUser.role;

    if (effectiveRole === 'guard') {
        const bodySocietyId =
            (req && req.body && (req.body.societyId || req.body.id)) ||
            null;

        let societyIdCandidate = bodySocietyId || authUser.societyId || null;

        if (!societyIdCandidate) {
            const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
            const onDuty = guardSocieties.find((s) => s && s.isOnDuty === true && s.societyId);
            if (onDuty && onDuty.societyId) {
                societyIdCandidate = onDuty.societyId;
            } else if (guardSocieties.length === 1 && guardSocieties[0] && guardSocieties[0].societyId) {
                societyIdCandidate = guardSocieties[0].societyId;
            }
        }

        if (!societyIdCandidate) {
            throw createHttpError('societyId is required.', 400);
        }

        const society = await Society.findById(societyIdCandidate).lean();
        if (!society) throw createHttpError('Society not found.', 404);
        assertSocietyIsAccessible(society);

        const guardSocieties = Array.isArray(authUser.guardSocieties) ? authUser.guardSocieties : [];
        const enrolledIds = new Set(
            [
                ...(guardSocieties || []).map((s) => (s && s.societyId ? String(s.societyId) : null)),
                authUser.societyId ? String(authUser.societyId) : null,
            ].filter(Boolean)
        );
        if (enrolledIds.size > 0 && !enrolledIds.has(String(society._id))) {
            throw createHttpError('You are not enrolled in this society.', 403);
        }

        return { society, unitDoc: null };
    }

    if (effectiveRole === 'member') {
        const unitIdCandidate =
            (req && req.body && (req.body.unitId || req.body.id)) ||
            null;

        if (!unitIdCandidate) {
            throw createHttpError('unitId is required.', 400);
        }

        const unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
        const society = await Society.findById(unitDoc.societyId).lean();
        if (!society) throw createHttpError('Society not found.', 404);
        assertSocietyIsAccessible(society);
        return { society, unitDoc };
    }

    const adminUnitIdCandidate = normalizeString(
        (req && req.body && (req.body.unitId || req.body.id)) ||
        (req && req.params && (req.params.unitId || req.params.id)) ||
        (req && req.query && (req.query.unitId || req.query.id)) ||
        ''
    );

    if (adminUnitIdCandidate) {
        if (!mongoose.Types.ObjectId.isValid(adminUnitIdCandidate)) {
            throw createHttpError('Invalid unitId.', 400);
        }

        const adminUnitDoc = await MemberUnit.findById(adminUnitIdCandidate, { societyId: 1 }).lean();
        if (!adminUnitDoc) {
            throw createHttpError('Unit not found.', 404);
        }

        await assertAdminAccessToSociety({
            req,
            authUser,
            societyId: adminUnitDoc.societyId,
        });

        const society = await Society.findById(adminUnitDoc.societyId).lean();
        if (!society) throw createHttpError('Society not found.', 404);
        assertSocietyIsAccessible(society);
        return { society, unitDoc: null };
    }

    const society = await resolveAdminSociety(req, authUser);
    return { society, unitDoc: null };
};

const toTruthyString = (v) => {
    const s = v == null ? '' : String(v).trim();
    return s ? s : '';
};

const countAdditionalResidentMembers = ({ occupants, familyMembers }) => {
    const linkedUserIdSet = new Set(
        (familyMembers || [])
            .map((fm) => (fm && fm.linkedUserId ? String(fm.linkedUserId) : ''))
            .filter(Boolean)
    );

    const occupantUserIds = new Set(
        (occupants || [])
            .map((o) => (o && o.memberId ? String(o.memberId) : ''))
            .filter(Boolean)
    );

    let extra = 0;
    occupantUserIds.forEach((id) => {
        if (!linkedUserIdSet.has(id)) extra += 1;
    });
    return extra;
};

const toValidTimestamp = (value) => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    const ts = d.getTime();
    return Number.isNaN(ts) ? null : ts;
};

const resolveAdminSociety = async (req, authUser) =>
    resolveAdminSocietyFromContext({ req, authUser });

const assertAdminAccessToSociety = async ({ req, authUser, societyId }) => {
    if (!societyId) {
        throw createHttpError('Society not found.', 404);
    }

    const linkedAdminIds = Array.from(
        new Set(
            [
                req?.user?.societyAdminId,
                authUser?.linkedSocietyAdminId,
                ...((authUser?.linkedSocietyAdminIds || []).map((id) => String(id))),
            ]
                .filter(Boolean)
                .map((id) => String(id))
        )
    );

    if (linkedAdminIds.length > 0) {
        const allowed = await Society.exists({
            _id: societyId,
            'societyAdmins._id': { $in: linkedAdminIds },
        });
        if (allowed) {
            return;
        }
    }

    const phoneMatches = await lookupSocietyAdminsByMobile(authUser?.phoneNumber || '');
    const hasPhoneMappedAccess = phoneMatches.some(
        (match) => String(match.societyId) === String(societyId)
    );
    if (hasPhoneMappedAccess) {
        return;
    }

    throw createHttpError('Forbidden: you are not mapped as admin for this society.', 403);
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

const findWingAndUnit = (society, wingName, unitNumber) => {
    const wings = Array.isArray(society.structure) ? society.structure : [];
    const wing = wings.find((w) => w?.wingName && w.wingName.trim().toLowerCase() === wingName.toLowerCase());
    if (!wing) return { wing: null, unit: null };
    const units = Array.isArray(wing.units) ? wing.units : [];
    const unit = units.find((u) => u?.unitNumber && u.unitNumber.trim().toLowerCase() === unitNumber.toLowerCase());
    return { wing, unit };
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
        assertSocietyInfoAccess(req, authUser);

        const { society, unitDoc } = await resolveSocietyForSocietyInfo(authUser, req);

        // Members should only see their own unit's data (summaries scoped to the unit).
        if ((req.user?.effectiveRole || authUser.role) === 'member' && unitDoc) {
            const kind = classifyUnitGroup([unitDoc]);
            const unitsSummary = {
                title: 'Units List',
                totalUnits: 1,
                ownerResiding: kind === 'owner' ? 1 : 0,
                tenantResiding: kind === 'tenant' ? 1 : 0,
                vacant: kind === 'vacant' ? 1 : 0,
                notRegisteredOnGatePal: 0,
            };

            const familyMembers = await FamilyMember.find({ unitId: unitDoc._id }).lean();

            const totalResidents = familyMembers.length;
            let adults = 0;
            let children = 0;
            familyMembers.forEach((fm) => {
                if (fm.category === 'adult') adults += 1;
                else if (fm.category === 'child') children += 1;
            });

            const linkedUserIdSet = new Set(
                familyMembers
                    .map((fm) => (fm && fm.linkedUserId ? String(fm.linkedUserId) : ''))
                    .filter(Boolean)
            );
            const selfUserId = authUser && authUser._id ? String(authUser._id) : '';
            const addSelf = selfUserId && !linkedUserIdSet.has(selfUserId);

            const residentsSummary = {
                title: 'Residents',
                totalResidents: totalResidents + (addSelf ? 1 : 0),
                adults: adults + (addSelf ? 1 : 0),
                children,
            };

            const canonicalUnitId = buildCanonicalUnitId(unitDoc);

            const vehicles = await Vehicle.find({ unitId: canonicalUnitId, deletedAt: null }).lean();

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

            const pets = await Pet.find({ unitId: canonicalUnitId, deletedAt: null }).lean();

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

            const petsSummary = {
                title: 'Pets',
                ...(dogs ? { dogs } : {}),
                ...(cats ? { cats } : {}),
                ...(parrots ? { parrots } : {}),
                ...(otherPets ? { others: otherPets } : {}),
            };

            const data = {
                societyId: String(society._id),
                societyName: society.societyName,
                unitsSummary,
                residentsSummary,
                vehiclesSummary,
                petsSummary,
                missingUnits: [],
            };

            return sendSuccessResponse(res, 200, 'Society info fetched successfully.', { data });
        }

        const wings = Array.isArray(society.structure) ? society.structure : [];
        const totalUnits = wings.reduce((sum, w) => {
            const units = Array.isArray(w.units) ? w.units.length : 0;
            const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
            return sum + (declared || units);
        }, 0);

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            {
                memberId: 1,
                wingName: 1,
                wingNameLower: 1,
                unitNumber: 1,
                unitNumberLower: 1,
                occupantType: 1,
                occupancyStatus: 1,
            }
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

        const officialStructureKeys = new Set();
        wings.forEach((wing) => {
            const wingLower = (wing.wingName || '').toString().trim().toLowerCase();
            const units = Array.isArray(wing.units) ? wing.units : [];
            units.forEach((u) => {
                const unitLower = (u.unitNumber || '').toString().trim().toLowerCase();
                if (wingLower && unitLower) {
                    officialStructureKeys.add(`${wingLower}:${unitLower}`);
                }
            });
        });

        const unitIds = occupants.map((u) => u._id);

        const familyMembers = unitIds.length
            ? await FamilyMember.find({ unitId: { $in: unitIds } }).lean()
            : [];

        const extraMemberResidents = countAdditionalResidentMembers({ occupants, familyMembers });
        const totalResidents = familyMembers.length + extraMemberResidents;
        let adults = 0;
        let children = 0;
        familyMembers.forEach((fm) => {
            if (fm.category === 'adult') adults += 1;
            else if (fm.category === 'child') children += 1;
        });

        const residentsSummary = {
            title: 'Residents',
            totalResidents,
            adults: adults + extraMemberResidents,
            children,
        };

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

        
        const petsSummary = {
            title: 'Pets',
            ...(dogs ? { dogs } : {}),
            ...(cats ? { cats } : {}),
            ...(parrots ? { parrots } : {}),
            ...(otherPets ? { others: otherPets } : {}),
        };

        
        const pendingMissing = await MissingUnitRequest.find(
            { societyId: society._id, status: 'pending' },
            { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, requestCount: 1, lastRequestedAt: 1 }
        )
            .sort({ lastRequestedAt: -1 })
            .lean();

        const pendingByKey = pendingMissing.reduce((acc, doc) => {
            const key = `${(doc.wingNameLower || '').toString()}:${(doc.unitNumberLower || '').toString()}`;
            if (!acc[key]) acc[key] = doc;
            return acc;
        }, {});

        const missingUnits = Object.keys(pendingByKey)
            .filter((key) => {
                
                return !officialStructureKeys.has(key);
            })
            .map((key) => {
                const doc = pendingByKey[key];
                return {
                    unitNumber: doc.unitNumber || null,
                    ...(doc.wingName ? { wingName: doc.wingName } : {}),
                    status: 'Requested',
                };
            });

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            unitsSummary,
            residentsSummary,
            vehiclesSummary,
            petsSummary,
            missingUnits,
        };

        return sendSuccessResponse(res, 200, 'Society info fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society info'));
    }
};

const getSocietyInfoUnits = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        assertSocietyInfoAccess(req, authUser);

        const { society, unitDoc } = await resolveSocietyForSocietyInfo(authUser, req);

        
        if ((req.user?.effectiveRole || authUser.role) === 'member' && unitDoc) {
            const kind = classifyUnitGroup([unitDoc]);
            const occupancyCategory = kind || 'owner';
            let statusLabel = 'Owner Residing';
            if (occupancyCategory === 'tenant') statusLabel = 'Tenant Residing';
            else if (occupancyCategory === 'vacant') statusLabel = 'Vacant';

            const unitsSummary = {
                title: 'Units List',
                totalUnits: 1,
                ownerResiding: occupancyCategory === 'owner' ? 1 : 0,
                tenantResiding: occupancyCategory === 'tenant' ? 1 : 0,
                vacant: occupancyCategory === 'vacant' ? 1 : 0,
                notRegisteredOnGatePal: 0,
            };

            const data = {
                societyId: String(society._id),
                societyName: society.societyName,
                unitsSummary,
                units: [
                    {
                        wingName: unitDoc.wingName,
                        unitNumber: unitDoc.unitNumber,
                        occupancyCategory,
                        statusLabel,
                    },
                ],
            };

            return sendSuccessResponse(res, 200, 'Society units fetched successfully.', { data });
        }

        const wings = Array.isArray(society.structure) ? society.structure : [];
        const totalUnits = wings.reduce((sum, w) => {
            const units = Array.isArray(w.units) ? w.units.length : 0;
            const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
            return sum + (declared || units);
        }, 0);

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            {
                memberId: 1,
                wingName: 1,
                wingNameLower: 1,
                unitNumber: 1,
                unitNumberLower: 1,
                occupantType: 1,
                occupancyStatus: 1,
            }
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
            unitList.map(
                (u) =>
                    `${(u.wingName || '').toString().toLowerCase()}:${(u.unitNumber || '').toString().toLowerCase()}`
            )
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

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            unitsSummary,
            units: unitList,
        };

        return sendSuccessResponse(res, 200, 'Society units fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society units'));
    }
};

const getSocietyInfoResidents = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        assertSocietyInfoAccess(req, authUser);

        const { society, unitDoc } = await resolveSocietyForSocietyInfo(authUser, req);

        
        if ((req.user?.effectiveRole || authUser.role) === 'member' && unitDoc) {
            const familyMembers = await FamilyMember.find({ unitId: unitDoc._id }).lean();

            const totalResidents = familyMembers.length;
            let adults = 0;
            let children = 0;
            familyMembers.forEach((fm) => {
                if (fm.category === 'adult') adults += 1;
                else if (fm.category === 'child') children += 1;
            });

            const linkedUserIdSet = new Set(
                familyMembers
                    .map((fm) => (fm && fm.linkedUserId ? String(fm.linkedUserId) : ''))
                    .filter(Boolean)
            );
            const selfUserId = authUser && authUser._id ? String(authUser._id) : '';
            const addSelf = selfUserId && !linkedUserIdSet.has(selfUserId);

            const residentsSummary = {
                title: 'Residents',
                totalResidents: totalResidents + (addSelf ? 1 : 0),
                adults: adults + (addSelf ? 1 : 0),
                children,
            };

            const residents = familyMembers.map((fm) => ({
                id: String(fm._id),
                name: fm.name,
                category: fm.category,
                unitId: String(fm.unitId),
                wingName: unitDoc.wingName || null,
                unitNumber: unitDoc.unitNumber || null,
                occupantType: unitDoc.occupantType || null,
                imageUrl: fm.imageUrl || null,
            }));

            if (addSelf) {
                residents.unshift({
                    id: selfUserId,
                    name: toTruthyString(authUser.fullName || authUser.name || null) || null,
                    category: 'adult',
                    unitId: String(unitDoc._id),
                    wingName: unitDoc.wingName || null,
                    unitNumber: unitDoc.unitNumber || null,
                    occupantType: unitDoc.occupantType || null,
                    imageUrl: authUser.profilePhoto || authUser.profileImageUrl || null,
                });
            }

            const data = {
                societyId: String(society._id),
                societyName: society.societyName,
                residentsSummary,
                residents,
            };

            return sendSuccessResponse(res, 200, 'Society residents fetched successfully.', { data });
        }

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            {
                memberId: 1,
                wingName: 1,
                wingNameLower: 1,
                unitNumber: 1,
                unitNumberLower: 1,
                occupantType: 1,
                occupancyStatus: 1,
            }
        ).lean();

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

        const linkedUserIdSet = new Set(
            familyMembers
                .map((fm) => (fm && fm.linkedUserId ? String(fm.linkedUserId) : ''))
                .filter(Boolean)
        );

        const memberIds = Array.from(
            new Set((occupants || []).map((u) => (u && u.memberId ? String(u.memberId) : '')).filter(Boolean))
        );
        const memberUsers = memberIds.length
            ? await User.find({ _id: { $in: memberIds } }, { fullName: 1, profilePhoto: 1 }).lean()
            : [];
        const userById = new Map(memberUsers.map((u) => [String(u._id), u]));

        const occupantResidents = [];
        (occupants || []).forEach((u) => {
            const userId = u && u.memberId ? String(u.memberId) : '';
            if (!userId) return;
            if (linkedUserIdSet.has(userId)) return;
            const userDoc = userById.get(userId);
            if (!userDoc) return;
            occupantResidents.push({
                id: userId,
                name: userDoc.fullName || null,
                category: 'adult',
                unitId: String(u._id),
                wingName: u.wingName || null,
                unitNumber: u.unitNumber || null,
                occupantType: u.occupantType || null,
                imageUrl: userDoc.profilePhoto || null,
            });
        });

        const extraMemberResidents = new Set(occupantResidents.map((r) => r.id)).size;

        const residentsSummary = {
            title: 'Residents',
            totalResidents: totalResidents + extraMemberResidents,
            adults: adults + extraMemberResidents,
            children,
        };

        const residents = familyMembers.map((fm) => {
            const unitInfo = unitObjectIdMap[String(fm.unitId)] || {};
            const unitNumber = unitInfo.unitNumber || null;
            return {
                id: String(fm._id),
                name: fm.name,
                category: fm.category,
                unitId: String(fm.unitId),
                wingName: unitInfo.wingName || null,
                unitNumber: unitNumber || null,
                occupantType: unitInfo.occupantType || null,
                imageUrl: fm.imageUrl || null,
            };
        });

        
        residents.unshift(...occupantResidents);

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            residentsSummary,
            residents,
        };

        return sendSuccessResponse(res, 200, 'Society residents fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society residents'));
    }
};

const updateSocietyResidentUnit = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) {
            return next(createHttpError('Unauthorized.', 401));
        }

        const isSocietyAdmin = isSocietyAdminPrincipal(req, authUser);
        if (!isSocietyAdmin) {
            return next(createHttpError('Only society admins can perform this action.', 403));
        }

        const unitIdCandidate = normalizeString(
            (req.params && (req.params.unitId || req.params.id)) ||
            (req.body && req.body.unitId) ||
            ''
        );
        if (!unitIdCandidate || !mongoose.Types.ObjectId.isValid(unitIdCandidate)) {
            return next(createHttpError('Invalid unitId.', 400));
        }

        const wingName = normalizeString(req.body?.wingName ?? req.body?.wing);
        const unitNumber = normalizeString(req.body?.unitNumber ?? req.body?.unit);

        if (!wingName || !unitNumber) {
            return next(createHttpError('wingName and unitNumber are required.', 400));
        }

        const unitDoc = await MemberUnit.findById(unitIdCandidate);
        if (!unitDoc) {
            return next(createHttpError('Unit not found.', 404));
        }

        await assertAdminAccessToSociety({
            req,
            authUser,
            societyId: unitDoc.societyId,
        });

        const society = await Society.findById(unitDoc.societyId).lean();
        if (!society) {
            return next(createHttpError('Society not found.', 404));
        }

        const { wing, unit } = findWingAndUnit(society, wingName, unitNumber);
        if (!wing) {
            return next(createHttpError('Wing not found in the society.', 404));
        }
        if (!unit) {
            return next(createHttpError('Unit not found in the specified wing.', 404));
        }

        const newWingLower = wingName.toLowerCase();
        const newUnitLower = unitNumber.toLowerCase();
        const oldWingLower = unitDoc.wingNameLower;
        const oldUnitLower = unitDoc.unitNumberLower;

        if (oldWingLower === newWingLower && oldUnitLower === newUnitLower) {
            return sendSuccessResponse(res, 200, 'No changes provided.', {
                data: {
                    id: String(unitDoc._id),
                    memberId: String(unitDoc.memberId),
                    wingName: unitDoc.wingName,
                    unitNumber: unitDoc.unitNumber,
                    occupantType: unitDoc.occupantType,
                },
            });
        }

        const duplicate = await MemberUnit.exists({
            memberId: unitDoc.memberId,
            societyId: unitDoc.societyId,
            wingNameLower: newWingLower,
            unitNumberLower: newUnitLower,
            _id: { $ne: unitDoc._id },
        });
        if (duplicate) {
            return next(createHttpError('This unit has already been added for the member.', 409));
        }

        if (unitDoc.occupantType === 'tenant') {
            const existingTenant = await MemberUnit.exists({
                societyId: unitDoc.societyId,
                wingNameLower: newWingLower,
                unitNumberLower: newUnitLower,
                occupantType: 'tenant',
                _id: { $ne: unitDoc._id },
            });
            if (existingTenant) {
                return next(createHttpError('A tenant is already registered for this unit.', 409));
            }
        }

        let primaryMemberId = unitDoc.primaryMemberId || null;
        if (unitDoc.occupantType === 'unit_owner_family_member') {
            const primaryOwner = await MemberUnit.findOne({
                societyId: unitDoc.societyId,
                wingNameLower: newWingLower,
                unitNumberLower: newUnitLower,
                occupantType: 'unit_owner',
            })
                .sort({ createdAt: 1 })
                .lean();
            primaryMemberId = primaryOwner ? primaryOwner.memberId : null;
        }
        if (unitDoc.occupantType === 'tenant_family_member') {
            const primaryTenant = await MemberUnit.findOne({
                societyId: unitDoc.societyId,
                wingNameLower: newWingLower,
                unitNumberLower: newUnitLower,
                occupantType: 'tenant',
            }).lean();
            primaryMemberId = primaryTenant ? primaryTenant.memberId : null;
        }

        const oldCanonicalUnitId = buildCanonicalUnitId(unitDoc);

        unitDoc.wingName = wingName;
        unitDoc.wingNameLower = newWingLower;
        unitDoc.unitNumber = unitNumber;
        unitDoc.unitNumberLower = newUnitLower;
        if (unitDoc.occupantType === 'unit_owner_family_member' || unitDoc.occupantType === 'tenant_family_member') {
            unitDoc.primaryMemberId = primaryMemberId;
        }

        await unitDoc.save();

        const newCanonicalUnitId = buildCanonicalUnitId(unitDoc);

        await Promise.all([
            Vehicle.updateMany({ memberId: unitDoc.memberId, unitId: oldCanonicalUnitId }, { $set: { unitId: newCanonicalUnitId } }),
            Pet.updateMany({ memberId: unitDoc.memberId, unitId: oldCanonicalUnitId }, { $set: { unitId: newCanonicalUnitId } }),
            Maintenance.updateMany({ memberId: unitDoc.memberId, unitId: oldCanonicalUnitId }, { $set: { unitId: newCanonicalUnitId } }),
            DailyHelpAssignment.updateMany({ memberId: unitDoc.memberId, unitId: oldCanonicalUnitId }, { $set: { unitId: newCanonicalUnitId } }),
        ]);

        const memberUser = await User.findById(unitDoc.memberId);
        if (memberUser && String(memberUser.societyId || '') === String(unitDoc.societyId)) {
            const memberWingLower = normalizeString(memberUser.wingName).toLowerCase();
            const memberUnitLower = normalizeString(memberUser.unitNumber).toLowerCase();
            if (!memberWingLower || !memberUnitLower || (memberWingLower === oldWingLower && memberUnitLower === oldUnitLower)) {
                memberUser.wingName = unitDoc.wingName;
                memberUser.unitNumber = unitDoc.unitNumber;
                if (memberUser.onboardingData?.member) {
                    memberUser.onboardingData.member.wingName = unitDoc.wingName;
                    memberUser.onboardingData.member.unitNumber = unitDoc.unitNumber;
                }
                memberUser.qrCodeImage = null;
                memberUser.qrCodeGeneratedAt = null;
                await memberUser.save();
            }
        }

        return sendSuccessResponse(res, 200, 'Resident unit updated successfully.', {
            data: {
                id: String(unitDoc._id),
                memberId: String(unitDoc.memberId),
                wingName: unitDoc.wingName,
                unitNumber: unitDoc.unitNumber,
                occupantType: unitDoc.occupantType,
                updatedAt: unitDoc.updatedAt,
            },
        });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to update resident unit'));
    }
};

const getSocietyInfoVehicles = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        assertSocietyInfoAccess(req, authUser);

        const { society, unitDoc } = await resolveSocietyForSocietyInfo(authUser, req);

        
        if ((req.user?.effectiveRole || authUser.role) === 'member' && unitDoc) {
            const canonicalUnitId = buildCanonicalUnitId(unitDoc);
            const vehicles = await Vehicle.find({ unitId: canonicalUnitId, deletedAt: null }).lean();

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

            const vehiclesList = vehicles.map((v) => ({
                id: String(v._id),
                vehicleNumber: v.vehicleNumber,
                vehicleType: v.vehicleType,
                unitNumber: unitDoc.unitNumber || null,
            }));

            const data = {
                societyId: String(society._id),
                societyName: society.societyName,
                vehiclesSummary,
                vehicles: vehiclesList,
            };

            return sendSuccessResponse(res, 200, 'Society vehicles fetched successfully.', { data });
        }

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
        ).lean();

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

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            vehiclesSummary,
            vehicles: vehiclesList,
        };

        return sendSuccessResponse(res, 200, 'Society vehicles fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society vehicles'));
    }
};

const getSocietyInfoPets = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        assertSocietyInfoAccess(req, authUser);

        const { society, unitDoc } = await resolveSocietyForSocietyInfo(authUser, req);

        
        if ((req.user?.effectiveRole || authUser.role) === 'member' && unitDoc) {
            const canonicalUnitId = buildCanonicalUnitId(unitDoc);
            const pets = await Pet.find({ unitId: canonicalUnitId, deletedAt: null }).lean();

            let dogs = 0;
            let cats = 0;
            let parrots = 0;
            let rabbits = 0;
            let hamsters = 0;
            let others = 0;
            pets.forEach((p) => {
                if (p.petType === 'Dog') dogs += 1;
                else if (p.petType === 'Cat') cats += 1;
                else if (p.petType === 'Parrot') parrots += 1;
                else if (p.petType === 'Rabbit') rabbits += 1;
                else if (p.petType === 'Hamsters') hamsters += 1;
                else others += 1;
            });

            const petsSummary = {
                title: 'Pets',
                ...(dogs ? { dogs } : {}),
                ...(cats ? { cats } : {}),
                ...(parrots ? { parrots } : {}),
                ...(rabbits ? { rabbits } : {}),
                ...(hamsters ? { hamsters } : {}),
                ...(others ? { others } : {}),
            };

            const petsList = pets.map((p) => ({
                id: String(p._id),
                name: p.name,
                petType: p.petType,
                unitNumber: unitDoc.unitNumber || null,
                vaccinationStatus: p.vaccinationStatus,
            }));

            const data = {
                societyId: String(society._id),
                societyName: society.societyName,
                petsSummary,
                pets: petsList,
            };

            return sendSuccessResponse(res, 200, 'Society pets fetched successfully.', { data });
        }

        const occupants = await MemberUnit.find(
            { societyId: society._id },
            { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
        ).lean();

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

        const prefix = `${String(society._id)}:`;

        const pets = await Pet.find({ unitId: { $regex: `^${prefix}` }, deletedAt: null }).lean();

        let dogs = 0;
        let cats = 0;
        let parrots = 0;
        let rabbits = 0;
        let hamsters = 0;
        let others = 0;
        pets.forEach((p) => {
            if (p.petType === 'Dog') dogs += 1;
            else if (p.petType === 'Cat') cats += 1;
            else if (p.petType === 'Parrot') parrots += 1;
            else if (p.petType === 'Rabbit') rabbits += 1;
            else if (p.petType === 'Hamsters') hamsters += 1;
            else others += 1;
        });

        
        const petsSummary = {
            title: 'Pets',
            ...(dogs ? { dogs } : {}),
            ...(cats ? { cats } : {}),
            ...(parrots ? { parrots } : {}),
            ...(rabbits ? { rabbits } : {}),
            ...(hamsters ? { hamsters } : {}),
            ...(others ? { others } : {}),
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

        const data = {
            societyId: String(society._id),
            societyName: society.societyName,
            petsSummary,
            pets: petsList,
        };

        return sendSuccessResponse(res, 200, 'Society pets fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society pets'));
    }
};

const getSocietyActivitySummary = async (req, res, next) => {
    try {
        const authUser = req.appUser;
        if (!authUser) {
            return next(createHttpError('Unauthorized.', 401));
        }

        const viewAsRaw = normalizeString(
            (req.body && req.body.viewAs) ||
            (req.params && req.params.viewAs) ||
            (req.query && req.query.viewAs) ||
            ''
        );
        const viewAs = viewAsRaw.toLowerCase();
        const effectiveRole = req.user?.effectiveRole || authUser.role;
        const isMemberView = effectiveRole === 'member' || viewAs === 'member';
        const isGuardView = effectiveRole === 'guard';

        let societyId = null;
        if (
            isSocietyAdminPrincipal(req, authUser) &&
            !isMemberView
        ) {
            const unitIdCandidate = normalizeString(
                (req.body && req.body.unitId) ||
                (req.params && (req.params.unitId || req.params.id)) ||
                (req.query && (req.query.unitId || req.query.id)) ||
                ''
            );

            if (unitIdCandidate) {
                if (!mongoose.Types.ObjectId.isValid(unitIdCandidate)) {
                    return next(createHttpError('Invalid unitId.', 400));
                }

                const unitDoc = await MemberUnit.findById(unitIdCandidate, { societyId: 1 }).lean();
                if (!unitDoc) {
                    return next(createHttpError('Unit not found.', 404));
                }

                await assertAdminAccessToSociety({
                    req,
                    authUser,
                    societyId: unitDoc.societyId,
                });
                societyId = unitDoc.societyId;
            } else {
                const society = await resolveAdminSociety(req, authUser);
                societyId = society._id;
            }
        } else if (isGuardView) {
            
            const societyIdCandidate = normalizeString(
                (req.body && req.body.societyId) ||
                (req.params && req.params.societyId) ||
                (req.query && req.query.societyId) ||
                ''
            );

            if (!societyIdCandidate) {
                return next(createHttpError('societyId is required for guards to view society activity summary.', 400));
            }

            
            const guardSocieties = authUser.guardSocieties || [];
            const isAssociatedWithSociety = guardSocieties.some(
                (gs) => String(gs.societyId) === societyIdCandidate
            );

            if (!isAssociatedWithSociety) {
                return next(createHttpError('Guard is not associated with this society.', 403));
            }

            societyId = societyIdCandidate;
        } else if (isMemberView) {
            const unitIdCandidate = normalizeString(
                (req.body && req.body.unitId) ||
                (req.params && (req.params.unitId || req.params.id)) ||
                (req.query && (req.query.unitId || req.query.id)) ||
                ''
            );

            if (!unitIdCandidate) {
                return next(createHttpError('unitId is required to view society activity summary.', 400));
            }

            let unitDoc;
            try {
                unitDoc = await assertUnitResidentAccess({ unitId: unitIdCandidate, authUser });
            } catch (e) {
                return next(e);
            }

            societyId = unitDoc.societyId;
        } else {
            return next(createHttpError('Only members, guards, or society admins can perform this action.', 403));
        }

        const society = await Society.findById(societyId).lean();
        if (!society) {
            return next(createHttpError('Society not found.', 404));
        }

        const [announcementDocs, meetingDocs, ruleDocs] = await Promise.all([
            Announcement.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
            Meeting.find({ societyId, deletedAt: null }).sort({ createdAt: -1 }).lean(),
            SocietyRule.find({ societyId, deletedAt: null }).lean(),
        ]);

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

        let unreadAnnouncementsCount = 0;
        const announcementItems = [];
        announcementDocs.forEach((doc) => {
            const { createdOn, updatedOn } = buildCreatedAndUpdatedOn(doc);
            const isRead = doc && doc.announcementId
                ? readAnnouncementIdsSet.has(String(doc.announcementId))
                : false;
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

            const isRead = doc && doc.meetingId
                ? readMeetingIdsSet.has(String(doc.meetingId))
                : false;
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
            if (effectiveAt) {
                const key = doc.categoryKey || '__uncategorized__';
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
                societyRules: unreadSocietyRulesCount,
            },
            announcements: recentAnnouncements,
            meetings: recentMeetings,
            societyRules: recentSocietyRules,
        };

        return sendSuccessResponse(res, 200, 'Society activity summary fetched successfully.', { data });
    } catch (error) {
        return next(setErrorDefaults(error, 'Failed to fetch society activity summary'));
    }
};

module.exports = {
    getSocietyInfo,
    getSocietyInfoUnits,
    getSocietyInfoResidents,
    updateSocietyResidentUnit,
    getSocietyInfoVehicles,
    getSocietyInfoPets,
    getSocietyActivitySummary,
};

