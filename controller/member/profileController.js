const crypto = require('crypto');
const QRCode = require('qrcode');
const validator = require('validator');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { countryCityData } = require('../../utils/countryCityData');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');
const { uploadBufferToS3 } = require('../../utils/s3Upload');

const findStateName = (countryName, cityName) => {
  const normalizedCountry = (countryName || '').toString().trim().toLowerCase();
  const normalizedCity = (cityName || '').toString().trim().toLowerCase();

  if (!normalizedCountry || !normalizedCity) {
    return null;
  }

  const country = countryCityData.find(
    (c) => (c.countryName || '').toString().trim().toLowerCase() === normalizedCountry
  );

  if (!country || !Array.isArray(country.states)) {
    return null;
  }

  const state = country.states.find(
    (st) =>
      Array.isArray(st.cities) &&
      st.cities.some(
        (city) => (city || '').toString().trim().toLowerCase() === normalizedCity
      )
  );

  return state && state.stateName ? state.stateName : null;
};

const generateStableMemberCode = (userId) => {
  const hex = crypto.createHash('sha256').update(String(userId)).digest('hex');
  const num = parseInt(hex.slice(0, 8), 16);
  return String((num % 900000) + 100000);
};

const buildQrPayload = ({ user, society, memberCode }) => {
  const payload = {
    type: 'gatepal_member',
    memberId: memberCode,
    userId: String(user._id),
    role: user.role,
    societyId: society ? String(society._id) : null,
    societyName: society ? society.societyName : user.societyName,
    wingName: user.wingName || null,
    unitNumber: user.unitNumber || null,
  };
  return JSON.stringify(payload);
};

const getMemberProfile = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const unitsFromDb = await MemberUnit.find({ memberId: user._id }).lean();

    const societyIds = new Set(unitsFromDb.map((u) => String(u.societyId)).filter(Boolean));
    const societies = societyIds.size
      ? await Society.find({ _id: { $in: Array.from(societyIds) } }).lean()
      : [];
    const societyMap = societies.reduce((acc, s) => {
      acc[String(s._id)] = s;
      return acc;
    }, {});

    const memberCode = generateStableMemberCode(user._id);

    let qrCodeImage = user.qrCodeImage || null;
    if (!qrCodeImage) {
      const currentSociety = user.societyId ? societyMap[String(user.societyId)] || null : null;
      const payload = buildQrPayload({ user, society: currentSociety, memberCode });
      try {
        const qrBuffer = await QRCode.toBuffer(payload, {
          type: 'png',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
        });
        qrCodeImage = await uploadBufferToS3({
          buffer: qrBuffer,
          contentType: 'image/png',
          keyPrefix: `members/${String(user._id)}/qr`,
          fileExtension: 'png',
          fileName: `member-qr-${Date.now()}`,
        });
        user.qrCodeImage = qrCodeImage;
        user.qrCodeGeneratedAt = new Date();
        await user.save();
      } catch (e) {
        qrCodeImage = null;
      }
    }

    const adminSocietyIds = new Set();

    
    if (req.user?.effectiveRole === 'society_admin' && req.user?.societyId) {
      adminSocietyIds.add(String(req.user.societyId));
    }

    
    const linkedAdminIds = Array.from(
      new Set(
        [
          req.user?.societyAdminId,
          user.linkedSocietyAdminId,
          ...((user.linkedSocietyAdminIds || []).map((id) => String(id))),
        ]
          .filter(Boolean)
          .map((id) => String(id))
      )
    );

    if (linkedAdminIds.length > 0) {
      const linkedAdminSocieties = await Society.find(
        { 'societyAdmins._id': { $in: linkedAdminIds } },
        { _id: 1 }
      ).lean();
      linkedAdminSocieties.forEach((societyDoc) => {
        adminSocietyIds.add(String(societyDoc._id));
      });
    }

    
    const phoneAdminMatches = await lookupSocietyAdminsByMobile(user.phoneNumber || '');
    phoneAdminMatches.forEach((match) => {
      if (match?.societyId) {
        adminSocietyIds.add(String(match.societyId));
      }
    });

    const responseData = {
      id: String(user._id),
      memberId: memberCode,
      name: user.fullName || null,
      countryCode: user.countryCode || '+91',
      imageUrl: user.profilePhoto || null,
      phoneNumber: user.phoneNumber,
      units: unitsFromDb.map((u) => {
        const s = societyMap[String(u.societyId)] || null;
        const societyRole =
          s && adminSocietyIds.has(String(s._id))
            ? 'society_admin'
            : 'member';

        return {
          id: String(u._id),
          wingName: u.wingName,
          unitNumber: u.unitNumber,
          occupantType: u.occupantType,
          occupancyStatus: u.occupancyStatus,
          society: s
            ? {
              id: String(s._id),
              name: s.societyName,
              pin: s.societyPin,
              address: s.address,
              city: s.city,
              stateName: findStateName(s.country, s.city),
              country: s.country,
              role: societyRole,
            }
            : null,
        };
      }),
      notificationPreferences: {
        notifyOnEntry: user.notifyOnEntry !== false,
        notifyOnExit: user.notifyOnExit !== false,
      },
      qrCodeImage,
      message:
        'Hello, our society is using GatePal™ app to manage our society. It is a wonderful application to manage guest entries and approvals. I strongly recommend for your society. You can download it from https://maplink.com',
    };

    return sendSuccessResponse(res, 200, 'Member profile fetched successfully.', {
      data: responseData,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch member profile'));
  }
};

const updateMemberProfile = async (req, res, next) => {
  try {
    console.log('[member/profile][PATCH] request received', {
      method: req.method,
      path: req.originalUrl || req.path,
      hasBody: Boolean(req.body && Object.keys(req.body).length),
      bodyKeys: req.body ? Object.keys(req.body) : [],
    });

    const user = req.appUser;
    if (!user) {
      console.log('[member/profile][PATCH] unauthorized request');
      return next(createHttpError('Unauthorized.', 401));
    }

    const { imageUrl, phoneNumber, name, fullName, email } = req.body || {};

    const updates = {};

    if (imageUrl !== undefined) {
      const photo = normalizeString(imageUrl);
      updates.profilePhoto = photo || null;
    }

    if (name !== undefined || fullName !== undefined) {
      const candidateName = toTitleCaseName(fullName !== undefined ? fullName : name);
      if (!candidateName) {
        return next(createHttpError('Name cannot be empty.', 400));
      }
      updates.fullName = candidateName;
    }

    if (email !== undefined) {
      const candidateEmail = normalizeString(email).toLowerCase();
      if (candidateEmail && !validator.isEmail(candidateEmail)) {
        return next(createHttpError('Invalid email address.', 400));
      }
      updates.email = candidateEmail || null;
    }

    if (phoneNumber !== undefined) {
      const digits = String(phoneNumber).replace(/\D/g, '');
      if (!digits || digits.length < 10 || digits.length > 12) {
        return next(createHttpError('Please enter a valid phone number.', 400));
      }
      const alreadyUser = await User.exists({ phoneNumber: digits, _id: { $ne: user._id } });
      if (alreadyUser) {
        return next(createHttpError('This phone number already exists in the system.', 409));
      }

      const SuperAdmin = require('../../model/superAdminSchema');
      const { lookupSocietyAdminByMobile } = require('../../utils/societyAdminUtils');

      const saExists = await SuperAdmin.exists({ phoneNumber: digits });
      if (saExists) {
        return next(createHttpError('This phone number already exists in the system.', 409));
      }

      const adminMatch = await lookupSocietyAdminByMobile(digits);
      if (adminMatch) {
        const linkedIds = new Set([
          ...(user.linkedSocietyAdminId ? [String(user.linkedSocietyAdminId)] : []),
          ...((user.linkedSocietyAdminIds || []).map((id) => String(id))),
        ]);
        if (!linkedIds.has(String(adminMatch.adminId))) {
          return next(createHttpError('This phone number already exists in the system.', 409));
        }
      }

      updates.phoneNumber = digits;
    }

    if (req.body && req.body.occupancyStatus !== undefined) {
      console.log('[member/profile][PATCH] rejected field', { field: 'occupancyStatus' });
      return next(createHttpError('occupancyStatus cannot be edited via profile.', 400));
    }

    if (Object.keys(updates).length === 0) {
      console.log('[member/profile][PATCH] response', {
        statusCode: 200,
        message: 'No changes provided.',
        userId: String(user._id),
      });
      return sendSuccessResponse(res, 200, 'No changes provided.');
    }

    Object.assign(user, updates);
    await user.save();

    const updateResponseData = {
      id: String(user._id),
      name: user.fullName || null,
      phoneNumber: user.phoneNumber,
      imageUrl: user.profilePhoto || null,
    };

    console.log('[member/profile][PATCH] response', updateResponseData);

    return sendSuccessResponse(res, 200, 'Member profile updated successfully.', {
      data: updateResponseData,
    });
  } catch (error) {
    console.error('[member/profile][PATCH] failed', {
      message: error?.message,
    });
    return next(setErrorDefaults(error, 'Failed to update member profile'));
  }
};

module.exports = {
  getMemberProfile,
  updateMemberProfile,
};
