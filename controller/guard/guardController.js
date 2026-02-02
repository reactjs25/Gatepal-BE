const validator = require('validator');
const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const GuardDutyLog = require('../../model/guardDutyLogSchema');
const DailyHelp = require('../../model/dailyHelpSchema');
const DailyHelpAssignment = require('../../model/dailyHelpAssignmentSchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const { toTitleCaseName } = require('../../utils/strings');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeString = (value) => (value || '').toString().trim();

const getAllSociety = async (req, res, next) => {
  try {
    const rawSocietyId = normalizeString(req?.body?.societyId || req?.query?.societyId);
    if (rawSocietyId && !validator.isMongoId(rawSocietyId)) {
      return next(createHttpError('Invalid societyId', 400));
    }

    const filter = rawSocietyId ? { _id: rawSocietyId } : {};
    const societies = await Society.find(filter, 'societyName societyPin city country structure').lean();
    const mapped = societies.map((s) => {
      const wings = Array.isArray(s.structure) ? s.structure : [];
      const normalizedWings = wings.map((w) => {
        const units = Array.isArray(w.units) ? w.units : [];
        const normalizedUnits = units.map((u) => ({
          id: String(u._id),
          unitNumber: u.unitNumber,
        }));
        const totalUnits =
          typeof w.totalUnits === 'number' ? w.totalUnits : normalizedUnits.length;
        return {
          id: String(w._id),
          name: w.wingName,
          totalUnits,
          units: normalizedUnits,
        };
      });
      return {
        id: String(s._id),
        name: s.societyName,
        pin: s.societyPin,
        city: s.city,
        country: s.country,
        wings: normalizedWings,
      };
    });
    return sendSuccessResponse(res, 200, 'Societies fetched successfully', { data: mapped });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch societies'));
  }
};


  const updateGuardProfile = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (user.role !== 'guard') {
      return next(createHttpError('Only guards can access this endpoint', 403));
    }

    const { imageUrl, phoneNumber, name, countryCode } = req.body || {};

    const updates = {};


    if (imageUrl !== undefined) {
      const photo = normalizeString(imageUrl);
      updates.profilePhoto = photo || null;
      if (photo) {
        updates.profilePhotoCapturedAt = new Date();
      }
    }

  
    if (name !== undefined) {
      const candidateName = toTitleCaseName(name);
      if (!candidateName) {
        return next(createHttpError('Name cannot be empty', 400));
      }
      updates.fullName = candidateName;
    }


    if (countryCode !== undefined) {
      const candidateCountryCode = normalizeString(countryCode);
      if (candidateCountryCode) {
        updates.countryCode = candidateCountryCode;
      }
    }

    if (phoneNumber !== undefined) {
      const digits = String(phoneNumber).replace(/\D/g, '');
      if (!digits || digits.length !== 10) {
        return next(createHttpError('phoneNumber must contain exactly 10 digits', 400));
      }

   
      const alreadyUser = await User.exists({ phoneNumber: digits, _id: { $ne: user._id } });
      if (alreadyUser) {
        return next(createHttpError('This phone number already exists in the system', 409));
      }

  
      const SuperAdmin = require('../../model/superAdminSchema');
      const saExists = await SuperAdmin.exists({ phoneNumber: digits });
      if (saExists) {
        return next(createHttpError('This phone number already exists in the system', 409));
      }


      const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');
      const adminMatch = await lookupSocietyAdminByMobile(digits);
      if (adminMatch) {
        const linkedId = user.linkedSocietyAdminId || null;
        if (!linkedId || String(linkedId) !== String(adminMatch.adminId)) {
          return next(createHttpError('This phone number already exists in the system', 409));
        }
      }

      updates.phoneNumber = digits;
    }

    if (Object.keys(updates).length === 0) {
      return sendSuccessResponse(res, 200, 'No changes provided');
    }

    Object.assign(user, updates);
    await user.save();

    return sendSuccessResponse(res, 200, 'Guard profile updated successfully', {
      data: {
        id: String(user._id),
        name: user.fullName || null,
        countryCode: user.countryCode || '+91',
        phoneNumber: user.phoneNumber,
        imageUrl: user.profilePhoto || null,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update guard profile'));
  }
};


const addSociety = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (user.role !== 'guard') {
      return next(createHttpError('Only guards can access this endpoint', 403));
    }

    const { societyName, societyPin } = req.body || {};

    const normalizedSocietyName = normalizeString(societyName);
    const normalizedSocietyPin = normalizeString(societyPin);

    if (!normalizedSocietyName) {
      return next(createHttpError('Society name is required', 400));
    }

    if (!normalizedSocietyPin) {
      return next(createHttpError('Society PIN is required', 400));
    }

 
    const nameRegex = new RegExp(`^${escapeRegex(normalizedSocietyName)}$`, 'i');
    const society = await Society.findOne({ societyName: nameRegex, societyPin: normalizedSocietyPin });

    if (!society) {
      return next(createHttpError('Society not found for provided name and PIN', 404));
    }

    if (!Array.isArray(user.guardSocieties)) {
      user.guardSocieties = [];
    }

    const alreadyEnrolled = user.guardSocieties.some(
      (s) => String(s.societyId) === String(society._id)
    );
    if (alreadyEnrolled) {
      return next(createHttpError('You are already enrolled in this society', 409));
    }

    user.guardSocieties.push({
      societyId: society._id,
      societyName: society.societyName,
      addedAt: new Date(),
    });

    if (!user.societyId) {
      user.societyId = society._id;
      user.societyName = society.societyName;
    }
    user.country = society.country || user.country;
    user.city = society.city || user.city;

    await user.save();

    return sendSuccessResponse(res, 200, 'Society added to guard profile successfully', {
      data: {
        id: String(user._id),
        name: user.fullName || null,
        society: {
          id: String(society._id),
          name: society.societyName,
          pin: society.societyPin,
          city: society.city,
          country: society.country,
        },
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to add society to guard profile'));
  }
};


const getGuardProfile = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (user.role !== 'guard') {
      return next(createHttpError('Only guards can access this endpoint', 403));
    }

  
    const guardSocieties = Array.isArray(user.guardSocieties) ? user.guardSocieties : [];
    const societyIds = guardSocieties.map((s) => s.societyId).filter(Boolean);
    const guardSocietyById = new Map(
      guardSocieties
        .filter((s) => s && s.societyId)
        .map((s) => [String(s.societyId), s])
    );

 
    if (user.societyId && !societyIds.some((id) => String(id) === String(user.societyId))) {
      societyIds.push(user.societyId);
    }

   
    const societiesFromDb = societyIds.length
      ? await Society.find({ _id: { $in: societyIds } }).lean()
      : [];

    const societies = societiesFromDb.map((society) => {
      const guardSociety = guardSocietyById.get(String(society._id)) || null;
      const dutyGateId = guardSociety?.dutyGateId ? String(guardSociety.dutyGateId) : null;
      const entryGates = Array.isArray(society.entryGates) ? society.entryGates : [];
      const exitGates = Array.isArray(society.exitGates) ? society.exitGates : [];

      const gates = [
        ...entryGates.map((g) => ({
          gateId: String(g._id),
          gateName: g.name,
          gateType: 'entry',
          isOnDuty: guardSociety?.isOnDuty === true && String(g._id) === dutyGateId,
        })),
        ...exitGates.map((g) => ({
          gateId: String(g._id),
          gateName: g.name,
          gateType: 'exit',
          isOnDuty: guardSociety?.isOnDuty === true && String(g._id) === dutyGateId,
        })),
      ];

      return {
        societyId: String(society._id),
        societyName: society.societyName,
        societyPin: society.societyPin,
        gates,
      };
    });

    return sendSuccessResponse(res, 200, 'Guard profile fetched successfully', {
      data: {
        id: String(user._id),
        name: user.fullName || null,
        countryCode: user.countryCode || '+91',
        phoneNumber: user.phoneNumber,
        imageUrl: user.profilePhoto || null,
        role: user.role,
        societies,
        message:
          'Hello, our society is using GatePal™ app to manage our society. It is a wonderful application to manage guest entries and approvals. I strongly recommend for your society. You can download it from https://maplink.com',
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guard profile'));
  }
};


const startDuty = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (user.role !== 'guard') {
      return next(createHttpError('Only guards can access this endpoint', 403));
    }

    const { societyId, gateId } = req.body || {};

    if (!societyId) {
      return next(createHttpError('Society ID is required', 400));
    }

    if (!gateId) {
      return next(createHttpError('Gate ID is required', 400));
    }

    const guardSocieties = Array.isArray(user.guardSocieties) ? user.guardSocieties : [];
    const societyIndex = guardSocieties.findIndex(
      (s) => String(s.societyId) === String(societyId)
    );

    if (societyIndex === -1) {
      return next(createHttpError('You are not enrolled in this society', 403));
    }

    const alreadyOnDuty = guardSocieties.find((s) => s.isOnDuty === true);
    if (alreadyOnDuty) {
      return next(createHttpError('You are already on duty at another society. Please end that duty first.', 409));
    }

    const society = await Society.findById(societyId).lean();
    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const allGates = [...(society.entryGates || []), ...(society.exitGates || [])];
    const gate = allGates.find((g) => String(g._id) === String(gateId));
    if (!gate) {
      return next(createHttpError('Gate not found in this society', 404));
    }

    user.guardSocieties[societyIndex].isOnDuty = true;
    user.guardSocieties[societyIndex].dutyGateId = gate._id;
    user.guardSocieties[societyIndex].dutyGateName = gate.name;
    user.guardSocieties[societyIndex].dutyStartedAt = new Date();

    await user.save();

    await GuardDutyLog.create({
      guardId: user._id,
      guardName: user.fullName || 'Unknown',
      guardPhone: user.phoneNumber || null,
      societyId: society._id,
      societyName: society.societyName,
      gateId: gate._id,
      gateName: gate.name,
      logType: 'duty_start',
      logTime: user.guardSocieties[societyIndex].dutyStartedAt,
    });

    return sendSuccessResponse(res, 200, 'Duty started successfully', {
      data: {
        societyId: String(society._id),
        societyName: society.societyName,
        gateId: String(gate._id),
        gateName: gate.name,
        dutyStartedAt: toISTDateTimeLabel(user.guardSocieties[societyIndex].dutyStartedAt),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to start duty'));
  }
};


const endDuty = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (user.role !== 'guard') {
      return next(createHttpError('Only guards can access this endpoint', 403));
    }

    const { societyId } = req.body || {};

    if (!societyId) {
      return next(createHttpError('Society ID is required', 400));
    }


    const guardSocieties = Array.isArray(user.guardSocieties) ? user.guardSocieties : [];
    const societyIndex = guardSocieties.findIndex(
      (s) => String(s.societyId) === String(societyId)
    );

    if (societyIndex === -1) {
      return next(createHttpError('You are not enrolled in this society', 403));
    }

    if (!user.guardSocieties[societyIndex].isOnDuty) {
      return next(createHttpError('You are not currently on duty at this society', 400));
    }

    const dutyStartedAt = user.guardSocieties[societyIndex].dutyStartedAt;
    const dutyEndedAt = new Date();
    const societyName = user.guardSocieties[societyIndex].societyName;
    const gateName = user.guardSocieties[societyIndex].dutyGateName;
    const gateId = user.guardSocieties[societyIndex].dutyGateId;

    user.guardSocieties[societyIndex].isOnDuty = false;
    user.guardSocieties[societyIndex].dutyGateId = null;
    user.guardSocieties[societyIndex].dutyGateName = null;
    user.guardSocieties[societyIndex].dutyStartedAt = null;

    await user.save();

    const society = await Society.findById(societyId).lean();

    await GuardDutyLog.create({
      guardId: user._id,
      guardName: user.fullName || 'Unknown',
      guardPhone: user.phoneNumber || null,
      societyId: societyId,
      societyName: society?.societyName || societyName,
      gateId: gateId,
      gateName: gateName,
      logType: 'duty_end',
      logTime: dutyEndedAt,
    });

    return sendSuccessResponse(res, 200, 'Duty ended successfully', {
      data: {
        societyId: String(societyId),
        societyName,
        gateName,
        dutyStartedAt: toISTDateTimeLabel(dutyStartedAt),
        dutyEndedAt: toISTDateTimeLabel(dutyEndedAt),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to end duty'));
  }
};

const DAILY_HELP_CATEGORIES = [
  { id: 'car_cleaner', name: 'Car Cleaner' },
  { id: 'cook', name: 'Cook' },
  { id: 'driver', name: 'Driver' },
  { id: 'gardener', name: 'Gardener' },
  { id: 'laundry', name: 'Laundry' },
  { id: 'maid', name: 'Maid' },
  { id: 'milkman', name: 'Milkman' },
  { id: 'nanny_baby_sitter', name: 'Nanny/Baby Sitter' },
  { id: 'others', name: 'Others' },
];

const getCategoryName = (categoryKey) => {
  if (!categoryKey) return null;
  const category = DAILY_HELP_CATEGORIES.find((c) => c.id === categoryKey);
  return category ? category.name : categoryKey;
};

const formatStatusForClient = (value) => {
  const v = normalizeString(value);
  if (!v) return v;
  const upper = v.toUpperCase();
  if (upper === 'PENDING') return 'Pending';
  if (upper === 'APPROVED') return 'Verified';
  if (upper === 'REJECTED') return 'Rejected';
  if (upper === 'REMOVED') return 'Removed';
  return v;
};

const listSocietyDailyHelpForGuard = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'guard') {
      return next(createHttpError('Only guards can perform this action', 403));
    }

    const societyIdCandidate = normalizeString(
      (req.body && req.body.societyId) || ''
    );

    if (!societyIdCandidate) {
      return next(createHttpError('societyId is required', 400));
    }

    if (!validator.isMongoId(societyIdCandidate)) {
      return next(createHttpError('Invalid societyId', 400));
    }

    // Verify guard is associated with this society
    const guardSocieties = authUser.guardSocieties || [];
    const isAssociatedWithSociety = guardSocieties.some(
      (gs) => String(gs.societyId) === societyIdCandidate
    );

    if (!isAssociatedWithSociety) {
      return next(createHttpError('Guard is not associated with this society', 403));
    }

    const society = await Society.findById(societyIdCandidate).lean();
    if (!society) {
      return next(createHttpError('Society not found', 404));
    }

    const categoryFilter = normalizeString((req.body || {}).category);

    // Only fetch approved daily helpers for guards
    const query = { societyId: society._id, status: 'APPROVED' };
    if (categoryFilter) query.category = categoryFilter.toLowerCase().replace(/\s+/g, '_');

    const items = await DailyHelp.find(query).sort({ createdAt: -1 }).lean();

    const helpIds = items.map((d) => d._id);
    const assignmentQuery = { dailyHelpId: { $in: helpIds }, status: 'APPROVED' };
    const assignments = await DailyHelpAssignment.find(assignmentQuery).lean();

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    const memberIds = Array.from(new Set(assignments.map((a) => String(a.memberId))));
    const users = await User.find({ _id: { $in: memberIds } }, { fullName: 1, phoneNumber: 1 }).lean();
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const unitLookups = assignments.map((a) => {
      const parsed = parseUnit(a.unitId);
      return {
        key: `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`,
        societyId: parsed.societyId,
        wingLower: parsed.wingLower,
        unitLower: parsed.unitLower,
        memberId: a.memberId,
      };
    });

    const uniqueUnitKeys = Array.from(new Set(unitLookups.map((x) => x.key)));
    const unitQueryOr = uniqueUnitKeys.map((key) => {
      const [memberId, wingLower, unitLower] = key.split(':');
      return { memberId, wingNameLower: wingLower, unitNumberLower: unitLower };
    });

    let units = [];
    if (unitQueryOr.length > 0) {
      units = await MemberUnit.find({ $or: unitQueryOr }, { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, memberId: 1 }).lean();
    }
    const unitMap = units.reduce((acc, u) => {
      acc[`${String(u.memberId)}:${u.wingNameLower}:${u.unitNumberLower}`] = u;
      return acc;
    }, {});

    const assignmentsByHelp = assignments.reduce((acc, a) => {
      const parsed = parseUnit(a.unitId);
      const key = `${String(a.memberId)}:${parsed.wingLower}:${parsed.unitLower}`;
      const unitDoc = unitMap[key];
      const userDoc = userMap[String(a.memberId)] || {};
      const record = {
        memberId: String(a.memberId),
        memberName: userDoc.fullName || null,
        memberPhone: userDoc.phoneNumber || null,
        wingName: unitDoc ? unitDoc.wingName : null,
        unitNumber: unitDoc ? unitDoc.unitNumber : null,
        unitId: unitDoc ? String(unitDoc._id) : null,
      };
      const hId = String(a.dailyHelpId);
      if (!acc[hId]) acc[hId] = [];
      acc[hId].push(record);
      return acc;
    }, {});

    const records = items.map((d) => ({
      id: String(d._id),
      societyId: String(d.societyId),
      name: d.name,
      category: getCategoryName(d.category),
      countryCode: d.countryCode || '+91',
      phoneNumber: d.phoneNumber || null,
      imageUrl: d.imageUrl || null,
      status: formatStatusForClient(d.status),
      createdByRole: d.createdByRole,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      requests: assignmentsByHelp[String(d._id)] || [],
    }));

    return sendSuccessResponse(res, 200, 'Society daily help fetched successfully', {
      data: records.length > 0 ? records : null,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch society daily help'));
  }
};

module.exports = {
  getAllSociety,
  updateGuardProfile,
  addSociety,
  getGuardProfile,
  startDuty,
  endDuty,
  listSocietyDailyHelpForGuard,
};
