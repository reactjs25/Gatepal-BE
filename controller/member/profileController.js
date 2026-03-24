const QRCode = require('qrcode');
const validator = require('validator');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { countryCityData } = require('../../utils/countryCityData');
const { lookupSocietyAdminsByMobile } = require('../../utils/societyAdminUtils');
const { normalizeCountryCode } = require('../../utils/phoneNumber');
const { normalizeString, toTitleCaseName } = require('../../utils/strings');
const { buildMemberQrPayloadString, generateStableMemberCode } = require('../../utils/memberQrIdentity');
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

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) {
    return value;
  }
  if (value.length === 0) {
    return undefined;
  }
  return value[value.length - 1];
};

const syncLinkedSocietyAdminProfile = async ({ user, updates }) => {
  const linkedAdminIds = Array.from(
    new Set(
      [
        user.linkedSocietyAdminId,
        ...((user.linkedSocietyAdminIds || []).map((id) => String(id))),
      ]
        .filter(Boolean)
        .map((id) => String(id))
    )
  );

  if (linkedAdminIds.length === 0) {
    return;
  }

  const societies = await Society.find({ 'societyAdmins._id': { $in: linkedAdminIds } });
  let hasSocietyChanges = false;

  for (const society of societies) {
    let societyChanged = false;

    for (const linkedAdminId of linkedAdminIds) {
      const admin = society.societyAdmins.id(linkedAdminId);
      if (!admin) {
        continue;
      }

      if (updates.fullName !== undefined && admin.name !== user.fullName) {
        admin.name = user.fullName;
        societyChanged = true;
      }

      if (updates.email !== undefined && admin.email !== user.email) {
        admin.email = user.email;
        societyChanged = true;
      }

      if (updates.phoneNumber !== undefined && admin.mobile !== user.phoneNumber) {
        admin.mobile = user.phoneNumber;
        societyChanged = true;
      }

      if (updates.countryCode !== undefined && admin.countryCode !== user.countryCode) {
        admin.countryCode = user.countryCode;
        societyChanged = true;
      }
    }

    if (societyChanged) {
      await society.save();
      hasSocietyChanges = true;
    }
  }

  return hasSocietyChanges;
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
      const payload = buildMemberQrPayloadString({ user, society: currentSociety });
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
      unitCount: unitsFromDb.length,
      hasUnits: unitsFromDb.length > 0,
      nextStep: unitsFromDb.length > 0 ? 'home' : 'add_unit',
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

    const payload = req.body || {};
    const imageRaw =
      payload.image !== undefined
        ? payload.image
        : payload.imageUrl !== undefined
          ? payload.imageUrl
          : payload.profilePhoto !== undefined
            ? payload.profilePhoto
            : payload.profileImage;
    const phoneNumber = getLastBodyValue(payload.phoneNumber);
    const name = getLastBodyValue(payload.name);
    const fullName = getLastBodyValue(payload.fullName);
    const email = getLastBodyValue(payload.email);
    const countryCode = getLastBodyValue(payload.countryCode);

    const updates = {};

    if (imageRaw !== undefined) {
      const photo = normalizeString(getLastBodyValue(imageRaw));
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

    if (countryCode !== undefined) {
      updates.countryCode = normalizeCountryCode(String(countryCode));
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

      const saExists = await SuperAdmin.exists({ phoneNumber: digits });
      if (saExists) {
        return next(createHttpError('This phone number already exists in the system.', 409));
      }

      const adminMatches = await lookupSocietyAdminsByMobile(digits);
      if (Array.isArray(adminMatches) && adminMatches.length > 0) {
        const linkedIds = new Set([
          ...(user.linkedSocietyAdminId ? [String(user.linkedSocietyAdminId)] : []),
          ...((user.linkedSocietyAdminIds || []).map((id) => String(id))),
        ]);
        const hasUnlinkedAdminConflict = adminMatches.some(
          (adminMatch) => !linkedIds.has(String(adminMatch.adminId))
        );
        if (hasUnlinkedAdminConflict) {
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
    await syncLinkedSocietyAdminProfile({ user, updates });

    const updateResponseData = {
      id: String(user._id),
      name: user.fullName || null,
      countryCode: user.countryCode || '+91',
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
