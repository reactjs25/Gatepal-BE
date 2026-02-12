const OtherVisitorPreApproval = require('../model/otherVisitorPreApprovalSchema');
const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { normalizeString } = require('../utils/strings');
const { ACTION_REASONS } = require('../utils/enums/actionReasonEnums');
const { toISTDateTimeLabelNoComma } = require('../utils/dateTime');
const { getWorkCategoryDisplayName } = require('../utils/workCategories');
const OtherVisitorCompany = require('../model/otherVisitorCompanySchema');
const { getOtherVisitorCompanyInfo } = require('../utils/otherVisitorCompanies');

const normalizeOption = (value) =>
  (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const canonicalizeEnumReason = (reasonInput, allowedReasons) => {
  const raw = normalizeString(reasonInput);
  if (!raw) return null;
  const needle = raw.toLowerCase();
  const match = (Array.isArray(allowedReasons) ? allowedReasons : []).find(
    (r) => normalizeString(r).toLowerCase() === needle
  );
  return match || null;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCompanyId = (name) =>
  (name || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const resolveOtherVisitorCompany = async (companyName) => {
  const trimmed = normalizeString(companyName);
  if (!trimmed) return null;

  const base = normalizeCompanyId(trimmed);
  let record = null;

  if (base) {
    record = await OtherVisitorCompany.findOne({ id: base }).lean();
  }
  if (!record) {
    const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
    record = await OtherVisitorCompany.findOne({ name: nameRegex }).lean();
  }

  if (record) {
    return { name: record.name, imageUrl: record.imageUrl };
  }

  const fallback = getOtherVisitorCompanyInfo(trimmed);
  return fallback ? { name: fallback.name, imageUrl: fallback.imageUrl } : null;
};

const parseDateTime = (value, fieldLabel) => {
  if (!value) {
    throw createHttpError(`${fieldLabel} is required.`, 400);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError(`Invalid ${fieldLabel} format.`, 400);
  }
  return d;
};

const computeValidityWindow = ({ validFrom, validTill, validityHours }) => {
  const start = parseDateTime(validFrom, 'validFrom');

  let end = null;

  if (validTill) {
    end = parseDateTime(validTill, 'validTill');
  } else {
    const hours = Number(validityHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw createHttpError('validityHours must be a positive number.', 400);
    }
    if (hours > 24) {
      throw createHttpError('validityHours cannot exceed 24 hours.', 400);
    }
    end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  }

  if (end <= start) {
    throw createHttpError('validTill must be after validFrom.', 400);
  }

  return { validFrom: start, validTill: end };
};

const computeUiBasedValidityWindow = ({
  dateOption,
  selectedDate,
  validityType,
  validityHours,
  untilTimeOption,
}) => {
  const now = new Date();
  const normalizedDateOption = normalizeOption(dateOption || 'today');
  const normalizedValidityType = normalizeOption(validityType || 'hours');
  const normalizedUntil = normalizeOption(untilTimeOption || '');

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let baseDate = new Date(today);

  if (normalizedDateOption === 'tomorrow') {
    baseDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  } else if (
    normalizedDateOption === 'select_date' ||
    normalizedDateOption === 'selectdate' ||
    normalizedDateOption === 'custom'
  ) {
    if (!selectedDate) {
      throw createHttpError('selectedDate is required when dateOption is selectDate.', 400);
    }
    const parsed = new Date(selectedDate);
    if (Number.isNaN(parsed.getTime())) {
      throw createHttpError('Invalid selectedDate format.', 400);
    }
    baseDate = new Date(parsed);
    baseDate.setHours(0, 0, 0, 0);
  }

  if (normalizedValidityType === 'until_time') {
    const mapUntilToHour = (token) => {
      const t = normalizeOption(token);
      if (!t || t === 'all_day' || t === 'allday') return null;
      if (t.includes('9_am')) return 9;
      if (t.includes('12_pm')) return 12;
      if (t.includes('3_pm')) return 15;
      if (t.includes('6_pm')) return 18;
      if (t.includes('9_pm')) return 21;
      if (t === '9am') return 9;
      if (t === '12pm') return 12;
      if (t === '3pm') return 15;
      if (t === '6pm') return 18;
      if (t === '9pm') return 21;
      return null;
    };

    const hour = mapUntilToHour(normalizedUntil);
    const start = new Date(baseDate);
    let end;

    if (hour == null) {
      end = new Date(baseDate);
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date(baseDate);
      end.setHours(hour, 0, 0, 0);
    }

    if (end <= start) {
      throw createHttpError('Computed validity end time must be after start time.', 400);
    }

    return { validFrom: start, validTill: end };
  }

  let start;
  if (
    normalizedDateOption === 'today' ||
    normalizedDateOption === 'none' ||
    !normalizedDateOption
  ) {
    start = now;
  } else {
    start = new Date(baseDate);
    start.setHours(9, 0, 0, 0);
  }

  return computeValidityWindow({
    validFrom: start.toISOString(),
    validTill: null,
    validityHours,
  });
};

const createOtherVisitorPreApproval = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can create visitor pre-approvals.', 403));
    }

    const {
      unitId,
      validFrom,
      validTill,
      validityHours,
      dateOption,
      selectedDate,
      validityType,
      untilTimeOption,
      workCategory,
      companyName,
      visitorName,
      guestName,
      personName,
      isPrivateInvite,
    } = req.body || {};

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const resolvedWorkCategory = getWorkCategoryDisplayName(workCategory);
    if (!resolvedWorkCategory) {
      return next(createHttpError('workCategory must be one of the common work categories.', 400));
    }

    let window;
    try {
      if (validFrom || validTill) {
        window = computeValidityWindow({ validFrom, validTill, validityHours });
      } else {
        window = computeUiBasedValidityWindow({
          dateOption,
          selectedDate,
          validityType,
          validityHours,
          untilTimeOption,
        });
      }
    } catch (e) {
      return next(e);
    }

    let resolvedCompanyName = null;
    const trimmedCompany = normalizeString(companyName);
    if (trimmedCompany) {
      const matchedCompany = await resolveOtherVisitorCompany(trimmedCompany);
      if (!matchedCompany) {
        return next(
          createHttpError(
            'companyName must match a registered other visitor company.',
            400
          )
        );
      }
      resolvedCompanyName = matchedCompany.name;
    }

    const resolvedVisitorName = normalizeString(visitorName ?? guestName ?? personName);

    const approval = await OtherVisitorPreApproval.create({
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
      invitedByUserId: authUser._id,
      visitorName: resolvedVisitorName || null,
      workCategory: resolvedWorkCategory,
      companyName: resolvedCompanyName,
      isPrivateInvite: Boolean(isPrivateInvite),
      validFrom: window.validFrom,
      validTill: window.validTill,
    });

    const member = await User.findById(authUser._id).lean();

    const fromLabel = toISTDateTimeLabelNoComma(window.validFrom);
    const tillLabel = toISTDateTimeLabelNoComma(window.validTill);
    const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;

    return sendSuccessResponse(res, 201, 'Visitor pre-approval created successfully.', {
      data: {
        preApprovalId: approval.preApprovalId,
        category: 'Visitor',
        visitorType: 'Other Visitor',
        workCategory: approval.workCategory,
        companyName: approval.companyName || null,
        visitorName: approval.visitorName || null,
        unit: {
          id: String(unitDoc._id),
          wingName: unitDoc.wingName,
          unitNumber: unitDoc.unitNumber,
        },
        invitedBy: {
          id: String(authUser._id),
          name: member?.fullName || authUser.fullName || null,
        },
        validityLabel,
        isPrivateInvite: Boolean(approval.isPrivateInvite),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create visitor pre-approval'));
  }
};

const updateOtherVisitorPreApproval = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can update visitor pre-approvals.', 403));
    }

    const preApprovalId = normalizeString(req.body?.preApprovalId);
    const {
      unitId,
      validFrom,
      validTill,
      validityHours,
      dateOption,
      selectedDate,
      validityType,
      untilTimeOption,
      workCategory,
      companyName,
      visitorName,
      guestName,
      personName,
      isPrivateInvite,
    } = req.body || {};

    if (!preApprovalId) return next(createHttpError('preApprovalId is required.', 400));
    if (!unitId) return next(createHttpError('unitId is required.', 400));

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const approval = await OtherVisitorPreApproval.findOne({
      preApprovalId,
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
    });
    if (!approval) return next(createHttpError('Pre-approval not found.', 404));
    if (approval.status !== 'active') {
      return next(createHttpError('Only active pre-approvals can be updated.', 409));
    }

    let resolvedWorkCategory = null;
    if (workCategory !== undefined) {
      resolvedWorkCategory = getWorkCategoryDisplayName(workCategory);
      if (!resolvedWorkCategory) {
        return next(createHttpError('workCategory must be one of the common work categories.', 400));
      }
    }

    let window = null;
    const shouldUpdateWindow =
      validFrom ||
      validTill ||
      validityHours !== undefined ||
      dateOption !== undefined ||
      selectedDate !== undefined ||
      validityType !== undefined ||
      untilTimeOption !== undefined;
    if (shouldUpdateWindow) {
      try {
        if (validFrom || validTill) {
          window = computeValidityWindow({ validFrom, validTill, validityHours });
        } else {
          window = computeUiBasedValidityWindow({
            dateOption,
            selectedDate,
            validityType,
            validityHours,
            untilTimeOption,
          });
        }
      } catch (e) {
        return next(e);
      }
    }

    let resolvedCompanyName = null;
    if (companyName !== undefined) {
      const trimmedCompany = normalizeString(companyName);
      if (trimmedCompany) {
        const matchedCompany = await resolveOtherVisitorCompany(trimmedCompany);
        if (!matchedCompany) {
          return next(createHttpError('companyName must match a registered other visitor company.', 400));
        }
        resolvedCompanyName = matchedCompany.name;
      } else {
        resolvedCompanyName = null;
      }
    }

    const resolvedVisitorName = normalizeString(visitorName ?? guestName ?? personName);

    if (resolvedVisitorName !== undefined) {
      approval.visitorName = resolvedVisitorName || null;
    }
    if (resolvedWorkCategory) {
      approval.workCategory = resolvedWorkCategory;
    }
    if (companyName !== undefined) {
      approval.companyName = resolvedCompanyName;
    }
    if (isPrivateInvite !== undefined) {
      approval.isPrivateInvite = Boolean(isPrivateInvite);
    }
    if (window) {
      approval.validFrom = window.validFrom;
      approval.validTill = window.validTill;
    }

    await approval.save();

    const member = await User.findById(authUser._id).lean();
    const fromLabel = toISTDateTimeLabelNoComma(approval.validFrom);
    const tillLabel = toISTDateTimeLabelNoComma(approval.validTill);
    const validityLabel = fromLabel && tillLabel ? `${fromLabel} to ${tillLabel}` : null;

    return sendSuccessResponse(res, 200, 'Visitor pre-approval updated successfully.', {
      data: {
        preApprovalId: approval.preApprovalId,
        category: 'Visitor',
        visitorType: 'Other Visitor',
        workCategory: approval.workCategory,
        companyName: approval.companyName || null,
        visitorName: approval.visitorName || null,
        unit: {
          id: String(unitDoc._id),
          wingName: unitDoc.wingName,
          unitNumber: unitDoc.unitNumber,
        },
        invitedBy: {
          id: String(authUser._id),
          name: member?.fullName || authUser.fullName || null,
        },
        validFrom: approval.validFrom,
        validTill: approval.validTill,
        validityLabel,
        isPrivateInvite: Boolean(approval.isPrivateInvite),
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update visitor pre-approval'));
  }
};

const cancelOtherVisitorPreApproval = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) return next(createHttpError('Unauthorized.', 401));
    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can cancel visitor pre-approvals.', 403));
    }

    const preApprovalId = normalizeString(req.body?.preApprovalId);
    const unitId = normalizeString(req.body?.unitId);
    const reason = normalizeString(req.body?.reason);
    const description = normalizeString(req.body?.description);

    if (!preApprovalId) return next(createHttpError('preApprovalId is required.', 400));
    if (!unitId) return next(createHttpError('unitId is required.', 400));
    if (!reason) return next(createHttpError('reason is required.', 400));

    const allowedReasons = ACTION_REASONS?.DELETE_PRE_APPROVAL?.other_visitor || [];
    const canonicalReason = canonicalizeEnumReason(reason, allowedReasons);
    if (!canonicalReason) {
      return next(createHttpError(`Invalid reason. Allowed: ${(allowedReasons || []).join(', ')}.`, 400));
    }
    if (canonicalReason.toLowerCase() === 'other' && !description) {
      return next(createHttpError('description is required when reason is other.', 400));
    }

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const approval = await OtherVisitorPreApproval.findOne({
      preApprovalId,
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
    });

    
    if (!approval) {
      const entryRequest = await GuestEntryRequest.findOne({
        requestId: preApprovalId,
        societyId: unitDoc.societyId,
        wingNameLower: unitDoc.wingNameLower,
        unitNumberLower: unitDoc.unitNumberLower,
        visitorType: 'other_visitor',
      });

      if (!entryRequest) {
        return next(createHttpError('Pre-approval not found.', 404));
      }

      if (entryRequest.status === 'cancelled') {
        return next(createHttpError('Entry request is already cancelled.', 400));
      }

      if (entryRequest.status === 'entered') {
        return next(createHttpError('Cannot cancel while visitor is inside society.', 409));
      }

      if (!['approved', 'pending'].includes(entryRequest.status)) {
        return next(createHttpError('Entry request cannot be cancelled in current status.', 400));
      }

      entryRequest.status = 'cancelled';
      await entryRequest.save();

      return sendSuccessResponse(res, 200, 'Entry request cancelled successfully.', {
        data: {
          preApprovalId: entryRequest.requestId,
          status: 'cancelled',
        },
      });
    }

    if (approval.status === 'cancelled') {
      return next(createHttpError('Pre-approval is already cancelled.', 400));
    }

    const activeEntry = await GuestEntryRequest.findOne({
      societyId: unitDoc.societyId,
      wingNameLower: unitDoc.wingNameLower,
      unitNumberLower: unitDoc.unitNumberLower,
      visitorType: 'other_visitor',
      status: 'entered',
      ...(approval.companyName ? { visitorCompanyName: approval.companyName } : {}),
      ...(approval.workCategory ? { visitorWorkCategory: approval.workCategory } : {}),
    }).lean();
    if (activeEntry) {
      return next(createHttpError('Cannot cancel pre-approval while visitor is inside society.', 409));
    }

    approval.status = 'cancelled';
    approval.cancelledReason = canonicalReason;
    approval.cancelledDescription = canonicalReason.toLowerCase() === 'other' ? (description || null) : null;
    approval.cancelledAt = new Date();
    approval.cancelledByUserId = authUser._id;
    await approval.save();

    return sendSuccessResponse(res, 200, 'Visitor pre-approval cancelled successfully.', {
      data: {
        preApprovalId: approval.preApprovalId,
        status: 'cancelled',
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to cancel visitor pre-approval'));
  }
};

module.exports = {
  createOtherVisitorPreApproval,
  updateOtherVisitorPreApproval,
  cancelOtherVisitorPreApproval,
};
