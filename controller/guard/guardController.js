const validator = require('validator');
const Society = require('../../model/societySchema');
const User = require('../../model/userSchema');
const GuardDutyLog = require('../../model/guardDutyLogSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { toISTDateTimeLabel } = require('../../utils/dateTime');
const { toTitleCaseName } = require('../../utils/strings');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeString = (value) => (value || '').toString().trim();

const getAllSociety = async (req, res, next) => {
  try {
    const societies = await Society.find({}, 'societyName societyPin city country structure').lean();
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
    const isOnDuty = guardSocieties.some((s) => s && s.isOnDuty === true);

 
    if (user.societyId && !societyIds.some((id) => String(id) === String(user.societyId))) {
      societyIds.push(user.societyId);
    }

   
    const societiesFromDb = societyIds.length
      ? await Society.find({ _id: { $in: societyIds } }).lean()
      : [];

    const societies = societiesFromDb.map((society) => {
      const entryGates = Array.isArray(society.entryGates) ? society.entryGates : [];
      const exitGates = Array.isArray(society.exitGates) ? society.exitGates : [];

      const gates = [
        ...entryGates.map((g) => ({
          gateId: String(g._id),
          gateName: g.name,
          gateType: 'entry',
        })),
        ...exitGates.map((g) => ({
          gateId: String(g._id),
          gateName: g.name,
          gateType: 'exit',
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
        isOnDuty,
        societies,
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

module.exports = {
  getAllSociety,
  updateGuardProfile,
  addSociety,
  getGuardProfile,
  startDuty,
  endDuty,
};
