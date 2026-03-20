const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../model/userSchema');
const MemberUnit = require('../model/memberUnitSchema');
const { generateNumericOtp, sendOtpToPhone, TEMPLATE_TYPES } = require('../utils/otpService');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { ROLE_TYPES, normalizeRole, APP_USER_ROLES } = require('../utils/userRoleUtils');
const { normalizePhoneNumber, normalizeCountryCode, normalizeDigits } = require('../utils/phoneNumber');
const { generateUserAuthToken } = require('../utils/authToken');
const { findSocietyAdminsByPhone } = require('../utils/societyAdminUtils');
const { assertSocietyIsAccessible, isSocietyAccessible } = require('../utils/societyAccess');
const { sendSuccessResponse } = require('../utils/response');
const { isSupportedLanguageCode, normalizeSupportedLanguageCode } = require('../utils/enums/languageEnums');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
const OTP_TTL_IN_MS = parseInt(process.env.OTP_TTL_IN_MS || '300000', 10);
const PASSWORD_RESET_TOKEN_TTL = parseInt(process.env.PASSWORD_RESET_TOKEN_TTL || '3600000', 10);

const pickActiveAdminContext = ({ contexts = [], lastLoggedInSocietyId }) => {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return null;
  }

  const activeContexts = contexts.filter(
    (ctx) => ctx?.admin?.status !== 'Inactive' && isSocietyAccessible(ctx?.society)
  );
  const candidatePool = activeContexts.length > 0 ? activeContexts : contexts;
  const preferredSocietyId = lastLoggedInSocietyId ? String(lastLoggedInSocietyId) : null;

  if (preferredSocietyId) {
    const preferred = candidatePool.find((ctx) => String(ctx.society?._id) === preferredSocietyId);
    if (preferred) {
      return preferred;
    }
  }

  return candidatePool[0] || null;
};

const pickPreferredAdminContext = ({ contexts = [], lastLoggedInSocietyId }) => {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return null;
  }

  const preferredSocietyId = lastLoggedInSocietyId ? String(lastLoggedInSocietyId) : null;

  if (preferredSocietyId) {
    const preferred = contexts.find((ctx) => String(ctx.society?._id) === preferredSocietyId);
    if (preferred) {
      return preferred;
    }
  }

  return contexts[0] || null;
};

const toAdminSociety = (context) => ({
  societyId: context.society?._id,
  societyName: context.society?.societyName,
  societyStatus: context.society?.status || null,
  adminId: context.admin?._id,
  adminStatus: context.admin?.status || null,
});

const mapAdminSocieties = (contexts = []) => contexts.map((ctx) => toAdminSociety(ctx));

const applyAdminContext = (principal, context) => {
  if (!principal || !context) {
    return;
  }

  principal.activeAdminContext = context;
  principal.doc = context.admin;
  principal.society = context.society;
  principal.save = () => context.society.save();
};

const upsertFcmToken = ({ tokenList, fcmToken, normalizedDeviceType, deviceId }) => {
  const list = Array.isArray(tokenList) ? tokenList : [];
  const existingTokenIndex = list.findIndex((t) => t.token === fcmToken);
  if (existingTokenIndex !== -1) {
    list[existingTokenIndex].deviceType = normalizedDeviceType;
    list[existingTokenIndex].deviceId = deviceId || null;
    list[existingTokenIndex].createdAt = new Date();
  } else {
    list.push({
      token: fcmToken,
      deviceType: normalizedDeviceType,
      deviceId: deviceId || null,
      createdAt: new Date(),
    });
  }

  if (list.length > 5) {
    return list
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
  }

  return list;
};

const findPrincipal = async ({ role, countryCode, phoneNumber }) => {
  const normalizedRole = normalizeRole(role);
  const rawPhone = normalizePhoneNumber(String(phoneNumber || ''));
  const digitsOnly = normalizeDigits(rawPhone);

  if (!digitsOnly) {
    throw createHttpError('Phone number is required.', 400);
  }

  const normalizedCountryCode = normalizeCountryCode(countryCode);

  const adminContexts = await findSocietyAdminsByPhone(digitsOnly);

  if (adminContexts.length) {
    let linkedUser = await User.findOne({ phoneNumber: digitsOnly });
    if (!linkedUser && rawPhone && rawPhone !== digitsOnly) {
      linkedUser = await User.findOne({ phoneNumber: rawPhone });
    }

    const activeContext = pickActiveAdminContext({
      contexts: adminContexts,
      lastLoggedInSocietyId: linkedUser?.lastLoggedInSocietyId || null,
    });

    const fallbackContext = pickPreferredAdminContext({
      contexts: adminContexts,
      lastLoggedInSocietyId: linkedUser?.lastLoggedInSocietyId || null,
    });

    const resolvedContext = activeContext || fallbackContext;

    if (!resolvedContext) {
      return null;
    }

    const principal = {
      type: ROLE_TYPES.SOCIETY_ADMIN,
      role: ROLE_TYPES.SOCIETY_ADMIN,
      countryCode: normalizedCountryCode,
      adminContexts,
      linkedUser,
      doc: resolvedContext.admin,
      society: resolvedContext.society,
      activeAdminContext: activeContext,
      save: () => resolvedContext.society.save(),
    };

    return principal;
  }

  if (APP_USER_ROLES.has(normalizedRole)) {
    const query = {
      role: normalizedRole,
      phoneNumber: digitsOnly,
    };

    if (normalizedCountryCode) {
      query.countryCode = normalizedCountryCode;
    }

    let user = await User.findOne(query);

    if (!user) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: digitsOnly,
      });
    }

    if (!user && rawPhone && rawPhone !== digitsOnly) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: rawPhone,
        ...(normalizedCountryCode ? { countryCode: normalizedCountryCode } : {}),
      });
    }

    if (!user && rawPhone && rawPhone !== digitsOnly) {
      user = await User.findOne({
        role: normalizedRole,
        phoneNumber: rawPhone,
      });
    }

    if (!user) {
      user = await User.findOne({ phoneNumber: digitsOnly });
    }

    if (!user && rawPhone) {
      user = await User.findOne({ phoneNumber: rawPhone });
    }

    if (user && !APP_USER_ROLES.has(user.role)) {
      user = null;
    }

    if (user) {
      return {
        type: 'user',
        role: user.role,
        countryCode: normalizedCountryCode,
        doc: user,
        save: () => user.save(),
      };
    }
  }

  return null;
};

const buildUserUnitState = ({ unitCount = 0 }) => ({
  unitCount,
  hasUnits: unitCount > 0,
  nextStep: unitCount > 0 ? 'home' : 'add_unit',
});

const mapPrincipalResponse = (principal, options = {}) => {
  const { unitCount = null } = options;
  if (principal.type === 'user') {
    const unitState = unitCount === null ? {} : buildUserUnitState({ unitCount });
    return {
      id: principal.doc._id,
      role: principal.doc.role,
      phoneNumber: principal.doc.phoneNumber,
      countryCode: principal.doc.countryCode,
      status: principal.doc.status,
      ...unitState,
    };
  }

  return {
    id: principal.doc._id,
    role: ROLE_TYPES.SOCIETY_ADMIN,
    phoneNumber: principal.doc.mobile,
    countryCode: principal.doc.countryCode || principal.countryCode,
    status: principal.doc.status,
    societyId: principal.society?._id,
    societyName: principal.society?.societyName,
    activeSociety: principal.activeAdminContext
      ? toAdminSociety(principal.activeAdminContext)
      : null,
    availableSocieties: mapAdminSocieties(principal.adminContexts || []),
    lastLoggedInSocietyId: principal.linkedUser?.lastLoggedInSocietyId || principal.society?._id || null,
  };
};

const getUserUnitCount = async (userId) => {
  if (!userId) return 0;
  return MemberUnit.countDocuments({ memberId: userId });
};

const ensureAccountIsActive = (principal) => {
  if (principal.type === 'user') {
    if (principal.doc.status === 'blocked') {
      throw createHttpError('Your account has been blocked. Contact support.', 403);
    }

    if (principal.doc.status === 'pending_otp') {
      throw createHttpError('Please verify the OTP sent to your number before logging in.', 403);
    }

    if (principal.doc.onboardingStatus !== 'completed') {
      throw createHttpError('Please complete onboarding before logging in.', 403);
    }

    return;
  }

  if (principal.doc.status === 'Inactive') {
    throw createHttpError('Your society admin account is inactive.', 403);
  }

  assertSocietyIsAccessible(principal.society, {
    inactiveMessage: `${principal.society?.societyName || 'This society'} is inactive. Please renew the contract to continue.`,
    suspendedMessage: `${principal.society?.societyName || 'This society'} is suspended. Please contact support.`,
  });
};

const login = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, password, fcmToken, deviceType, deviceId } = req.body;

    if (!role || !phoneNumber || !password) {
      throw createHttpError('Role, phone number, and password are required.', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details.', 404);
    }


   
    const normalizedRequestedRole = normalizeRole(role);
    const allowedMemberAppRoles = new Set([ROLE_TYPES.MEMBER, ROLE_TYPES.SOCIETY_ADMIN]);
    const allowedGuardAppRoles = new Set([ROLE_TYPES.GUARD]);
    const allowedVisitorAppRoles = new Set([ROLE_TYPES.VISITOR]);
    

    if (normalizedRequestedRole === ROLE_TYPES.MEMBER && !allowedMemberAppRoles.has(principal.role)) {
      throw createHttpError('Invalid credentials.', 401);
    }
    
    
    if (normalizedRequestedRole === ROLE_TYPES.GUARD && !allowedGuardAppRoles.has(principal.role)) {
      throw createHttpError('Invalid credentials.', 401);
    }
    
    
    if (normalizedRequestedRole === ROLE_TYPES.VISITOR && !allowedVisitorAppRoles.has(principal.role)) {
      throw createHttpError('Invalid credentials.', 401);
    }

    ensureAccountIsActive(principal);

    let isPasswordValid = false;

    if (principal.type === 'user') {
      isPasswordValid = await principal.doc.comparePassword(password);
    } else {
      const contexts = principal.adminContexts || [];
      const linkedUser = principal.linkedUser;
      let matchedContext = null;

      if (linkedUser) {
        isPasswordValid = await linkedUser.comparePassword(password);
        if (isPasswordValid) {
          matchedContext = pickActiveAdminContext({
            contexts,
            lastLoggedInSocietyId: linkedUser.lastLoggedInSocietyId || null,
          }) || contexts[0] || null;
        }
      }

      if (!isPasswordValid) {
        for (const context of contexts) {
          const adminDoc = context.admin;
          const adminHasPassword = Boolean(adminDoc.password);
          let contextValid = false;

          if (adminHasPassword) {
            contextValid = await bcrypt.compare(password, adminDoc.password || '');
          } else if (linkedUser) {
            contextValid = await bcrypt.compare(password, linkedUser.password || '');
            if (contextValid) {
              adminDoc.password = linkedUser.password;
              await context.society.save();
            }
          }

          if (contextValid) {
            isPasswordValid = true;
            matchedContext = context;
            break;
          }
        }
      }

      if (isPasswordValid && matchedContext) {
        applyAdminContext(principal, matchedContext);
      }

      if (isPasswordValid && linkedUser) {
        const linkedAdminIds = contexts.map((ctx) => String(ctx.admin._id));
        linkedUser.linkedSocietyAdminId = principal.doc._id;
        linkedUser.linkedSocietyAdminIds = Array.from(
          new Set([...(linkedUser.linkedSocietyAdminIds || []).map((id) => String(id)), ...linkedAdminIds])
        );
        linkedUser.lastLoggedInSocietyId = principal.society?._id || null;
        if (!linkedUser.upgradedToSocietyAdminAt) {
          linkedUser.upgradedToSocietyAdminAt = new Date();
        }
        await linkedUser.save();
      }
    }

    if (!isPasswordValid) {
      throw createHttpError('Invalid credentials.', 401);
    }

    const token = generateUserAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    if (fcmToken) {
      const normalizedDeviceType = (deviceType || 'android').toLowerCase();

      if (principal.type === 'user') {
        const user = principal.doc;

        const existingTokenIndex = user.fcmTokens
          ? user.fcmTokens.findIndex((t) => t.token === fcmToken)
          : -1;

        if (existingTokenIndex !== -1) {
          user.fcmTokens[existingTokenIndex].deviceType = normalizedDeviceType;
          user.fcmTokens[existingTokenIndex].deviceId = deviceId || null;
          user.fcmTokens[existingTokenIndex].createdAt = new Date();
        } else {
          await User.updateMany(
            { _id: { $ne: user._id }, 'fcmTokens.token': fcmToken },
            { $pull: { fcmTokens: { token: fcmToken } } }
          );

          if (!user.fcmTokens) {
            user.fcmTokens = [];
          }

          user.fcmTokens.push({
            token: fcmToken,
            deviceType: normalizedDeviceType,
            deviceId: deviceId || null,
            createdAt: new Date(),
          });

          if (user.fcmTokens.length > 5) {
            user.fcmTokens = user.fcmTokens
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .slice(0, 5);
          }
        }

        await user.save();
      }

      if (principal.type === ROLE_TYPES.SOCIETY_ADMIN) {
        const admin = principal.doc;
        const linkedUser = principal.linkedUser || null;

        admin.fcmTokens = upsertFcmToken({
          tokenList: admin.fcmTokens,
          fcmToken,
          normalizedDeviceType,
          deviceId,
        });

        if (principal.save) {
          await principal.save();
        }

        
        
        if (linkedUser) {
          await User.updateMany(
            { _id: { $ne: linkedUser._id }, 'fcmTokens.token': fcmToken },
            { $pull: { fcmTokens: { token: fcmToken } } }
          );

          linkedUser.fcmTokens = upsertFcmToken({
            tokenList: linkedUser.fcmTokens,
            fcmToken,
            normalizedDeviceType,
            deviceId,
          });
          await linkedUser.save();
        }
      }
    }

    const unitCount = principal.type === 'user'
      ? await getUserUnitCount(principal.doc._id)
      : null;

    res.locals.languageCode = normalizeSupportedLanguageCode(
      principal.linkedUser?.preferredLanguage || principal.doc?.preferredLanguage || 'en'
    ) || 'en';

    return sendSuccessResponse(res, 200, 'Login successful.', {
      data: mapPrincipalResponse(principal, { unitCount }),
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to login'));
  }
};

const switchSociety = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const effectiveRole = req.user?.effectiveRole || authUser.role;
    if (
      effectiveRole !== ROLE_TYPES.SOCIETY_ADMIN &&
      !authUser.linkedSocietyAdminId &&
      !(Array.isArray(authUser.linkedSocietyAdminIds) && authUser.linkedSocietyAdminIds.length > 0)
    ) {
      throw createHttpError('Forbidden: only society admins can switch society context.', 403);
    }

    const requestedSocietyId = req.body?.societyId;
    if (!requestedSocietyId || !mongoose.Types.ObjectId.isValid(requestedSocietyId)) {
      throw createHttpError('A valid societyId is required.', 400);
    }

    const contexts = await findSocietyAdminsByPhone(authUser.phoneNumber || '');
    if (!contexts.length) {
      throw createHttpError('No society admin mapping found for this user.', 404);
    }

    const targetContext = contexts.find(
      (ctx) => String(ctx.society?._id) === String(requestedSocietyId)
    );

    if (!targetContext) {
      throw createHttpError('You are not mapped as an admin for this society.', 403);
    }

    if (targetContext.admin?.status === 'Inactive') {
      throw createHttpError('Your society admin account is inactive for the selected society.', 403);
    }

    assertSocietyIsAccessible(targetContext.society, {
      inactiveMessage: `${targetContext.society?.societyName || 'This society'} is inactive. Please renew the contract to continue.`,
      suspendedMessage: `${targetContext.society?.societyName || 'This society'} is suspended. Please contact support.`,
    });

    const adminIds = contexts.map((ctx) => String(ctx.admin._id));
    authUser.linkedSocietyAdminId = targetContext.admin._id;
    authUser.linkedSocietyAdminIds = Array.from(
      new Set([...(authUser.linkedSocietyAdminIds || []).map((id) => String(id)), ...adminIds])
    );
    authUser.lastLoggedInSocietyId = targetContext.society._id;
    if (!authUser.upgradedToSocietyAdminAt) {
      authUser.upgradedToSocietyAdminAt = new Date();
    }
    await authUser.save();

    const token = generateUserAuthToken({
      id: targetContext.admin._id,
      role: ROLE_TYPES.SOCIETY_ADMIN,
      extraClaims: { societyId: targetContext.society._id },
    });

    return sendSuccessResponse(res, 200, 'Society switched successfully.', {
      data: {
        id: targetContext.admin._id,
        role: ROLE_TYPES.SOCIETY_ADMIN,
        phoneNumber: targetContext.admin.mobile,
        countryCode: targetContext.admin.countryCode || authUser.countryCode,
        status: targetContext.admin.status,
        societyId: targetContext.society._id,
        societyName: targetContext.society.societyName,
        activeSociety: toAdminSociety(targetContext),
        availableSocieties: mapAdminSocieties(contexts),
        lastLoggedInSocietyId: authUser.lastLoggedInSocietyId,
      },
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to switch society context'));
  }
};

const requestPasswordOtp = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber } = req.body;

    if (!role || !phoneNumber) {
      throw createHttpError('Role and mobile number are required.', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details.', 404);
    }

    ensureAccountIsActive(principal);

    const otp = generateNumericOtp(4);
    if (principal.type === 'user') {
      principal.doc.setOtp(otp, { markPendingStatus: false });
    } else {
      principal.doc.setOtp(otp);
    }
    principal.doc.resetPasswordToken = null;
    principal.doc.resetPasswordExpires = null;

    await principal.save();

    await sendOtpToPhone({
      countryCode: principal.doc.countryCode || countryCode,
      phoneNumber: principal.doc.phoneNumber || principal.doc.mobile || phoneNumber,
      otp,
      templateType: TEMPLATE_TYPES.FORGOT_PASSWORD,
    });

    return sendSuccessResponse(res, 200, 'OTP sent successfully.', {
      data: {
        otpValidForMs: OTP_TTL_IN_MS,
        otp,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to send OTP'));
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, otp } = req.body;

    if (!role || !phoneNumber || !otp) {
      throw createHttpError('Role, mobile number, and OTP are required.', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details.', 404);
    }

    ensureAccountIsActive(principal);

    const isValid = principal.doc.verifyOtp(otp);

    if (!isValid) {
      throw createHttpError('OTP you have entered is incorrect.', 400);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    principal.doc.resetPasswordToken = hashedToken;
    principal.doc.resetPasswordExpires = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL);

    await principal.save();

    return sendSuccessResponse(res, 200, 'OTP verified successfully.', {
      data: {
        resetToken,
        resetTokenExpiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to verify OTP'));
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { role, countryCode, phoneNumber, password, resetToken } = req.body;

    if (!role || !phoneNumber || !password || !resetToken) {
      throw createHttpError('Role, mobile number, password, and reset token are required.', 400);
    }

    const principal = await findPrincipal({ role, countryCode, phoneNumber });

    if (!principal) {
      throw createHttpError('Account not found for the provided details.', 404);
    }

    ensureAccountIsActive(principal);

    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const tokenMatches =
      principal.doc.resetPasswordToken === hashedToken &&
      principal.doc.resetPasswordExpires &&
      principal.doc.resetPasswordExpires.getTime() > Date.now();

    if (!tokenMatches) {
      throw createHttpError('Invalid or expired reset token.', 400);
    }

    if (principal.type === 'user') {
      principal.doc.password = password;
    } else {
      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      principal.doc.password = await bcrypt.hash(password, salt);
    }

    principal.doc.resetPasswordToken = null;
    principal.doc.resetPasswordExpires = null;

    await principal.save();

    const token = generateUserAuthToken({
      id: principal.doc._id,
      role: principal.role,
      extraClaims:
        principal.type === ROLE_TYPES.SOCIETY_ADMIN
          ? { societyId: principal.society?._id }
          : {},
    });

    const unitCount = principal.type === 'user'
      ? await getUserUnitCount(principal.doc._id)
      : null;

    return sendSuccessResponse(res, 200, 'Password reset successful.', {
      data: mapPrincipalResponse(principal, { unitCount }),
      token,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to reset password'));
  }
};


const registerFcmToken = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { fcmToken, deviceType, deviceId } = req.body;

    if (!fcmToken) {
      throw createHttpError('fcmToken is required.', 400);
    }

    const normalizedDeviceType = (deviceType || 'android').toLowerCase();
    if (!['android', 'ios', 'web'].includes(normalizedDeviceType)) {
      throw createHttpError('deviceType must be android, ios, or web.', 400);
    }

    
    const user = await User.findById(authUser._id);
    if (!user) {
      throw createHttpError('User not found.', 404);
    }

    
    const existingTokenIndex = user.fcmTokens.findIndex(
      (t) => t.token === fcmToken
    );

    if (existingTokenIndex !== -1) {
      
      user.fcmTokens[existingTokenIndex].deviceType = normalizedDeviceType;
      user.fcmTokens[existingTokenIndex].deviceId = deviceId || null;
      user.fcmTokens[existingTokenIndex].createdAt = new Date();
    } else {
      
      await User.updateMany(
        { _id: { $ne: authUser._id }, 'fcmTokens.token': fcmToken },
        { $pull: { fcmTokens: { token: fcmToken } } }
      );

      
      user.fcmTokens.push({
        token: fcmToken,
        deviceType: normalizedDeviceType,
        deviceId: deviceId || null,
        createdAt: new Date(),
      });

      
      if (user.fcmTokens.length > 5) {
        user.fcmTokens = user.fcmTokens
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 5);
      }
    }

    await user.save();

    return sendSuccessResponse(res, 200, 'FCM token registered successfully.', {
      data: {
        tokenCount: user.fcmTokens.length,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to register FCM token'));
  }
};


const removeFcmToken = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { fcmToken } = req.body;

    if (!fcmToken) {
      throw createHttpError('fcmToken is required.', 400);
    }

    await User.findByIdAndUpdate(authUser._id, {
      $pull: { fcmTokens: { token: fcmToken } },
    });

    return sendSuccessResponse(res, 200, 'FCM token removed successfully.');
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to remove FCM token'));
  }
};

const getPreferences = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const user = await User.findById(authUser._id).select('preferredLanguage');
    if (!user) {
      throw createHttpError('User not found.', 404);
    }

    return sendSuccessResponse(res, 200, 'Preferences fetched successfully.', {
      data: {
        preferredLanguage: user.preferredLanguage || 'en',
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch preferences'));
  }
};

const updatePreferences = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      throw createHttpError('Unauthorized.', 401);
    }

    const { preferredLanguage } = req.body;

    if (typeof preferredLanguage !== 'string' || !preferredLanguage.trim()) {
      throw createHttpError('preferredLanguage is required.', 400);
    }

    const normalizedLanguageCode = normalizeSupportedLanguageCode(preferredLanguage);
    if (!isSupportedLanguageCode(normalizedLanguageCode)) {
      throw createHttpError('Unsupported preferredLanguage value.', 400);
    }

    const user = await User.findByIdAndUpdate(
      authUser._id,
      {
        $set: {
          preferredLanguage: normalizedLanguageCode,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).select('preferredLanguage');

    if (!user) {
      throw createHttpError('User not found.', 404);
    }

    return sendSuccessResponse(res, 200, 'Preferences updated successfully.', {
      data: {
        preferredLanguage: user.preferredLanguage,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update preferences'));
  }
};

module.exports = {
  login,
  switchSociety,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
  registerFcmToken,
  removeFcmToken,
  getPreferences,
  updatePreferences,
};


