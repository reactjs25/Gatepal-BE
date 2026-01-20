const TaxiDriverPreApproval = require('../model/taxiDriverPreApprovalSchema');
const User = require('../model/userSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { assertUnitResidentAccess } = require('../utils/unitAccess');
const { normalizeString } = require('../utils/strings');
const { toISTDateLabel, toISTTimeLabel } = require('../utils/dateTime');
const { getTaxiCompanyInfo } = require('../utils/taxiDriverCompanies');

const normalizeOption = (value) =>
  (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const parseDateTime = (value, fieldLabel) => {
  if (!value) {
    throw createHttpError(`${fieldLabel} is required`, 400);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw createHttpError(`Invalid ${fieldLabel} format`, 400);
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
      throw createHttpError('validityHours must be a positive number', 400);
    }
    if (hours > 24) {
      throw createHttpError('validityHours cannot exceed 24 hours', 400);
    }
    end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  }

  if (end <= start) {
    throw createHttpError('validTill must be after validFrom', 400);
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
      throw createHttpError('selectedDate is required when dateOption is selectDate', 400);
    }
    const parsed = new Date(selectedDate);
    if (Number.isNaN(parsed.getTime())) {
      throw createHttpError('Invalid selectedDate format', 400);
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
      throw createHttpError('Computed validity end time must be after start time', 400);
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

const resolveCompanyData = ({ companyName }) => {
  const trimmedName = normalizeString(companyName);
  if (!trimmedName) return null;
  const company = getTaxiCompanyInfo(trimmedName);
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    imageUrl: company.imageUrl || null,
  };
};

const createTaxiDriverPreApproval = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized', 401));
    }

    if (authUser.role !== 'member' && authUser.role !== 'society_admin') {
      return next(createHttpError('Only members can create taxi driver pre-approvals', 403));
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
      companyName,
      vehicleNumber,
    } = req.body || {};

    let unitDoc;
    try {
      unitDoc = await assertUnitResidentAccess({ unitId, authUser });
    } catch (e) {
      return next(e);
    }

    const resolvedCompany = resolveCompanyData({ companyName });
    if (!resolvedCompany) {
      return next(createHttpError('companyName must be one of: Ola, Uber, Meru, Rapido', 400));
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

    const approval = await TaxiDriverPreApproval.create({
      societyId: unitDoc.societyId,
      unitId: unitDoc._id,
      invitedByUserId: authUser._id,
      companyId: resolvedCompany.id || null,
      companyName: resolvedCompany.name,
      companyImageUrl: resolvedCompany.imageUrl || null,
      vehicleNumber: normalizeString(vehicleNumber).toUpperCase() || null,
      validFrom: window.validFrom,
      validTill: window.validTill,
    });

    const member = await User.findById(authUser._id).lean();

    const dateLabel = toISTDateLabel(window.validFrom);
    const fromTimeLabel = toISTTimeLabel(window.validFrom);
    const tillTimeLabel = toISTTimeLabel(window.validTill);
    const validityLabel = `${dateLabel}, ${fromTimeLabel} to ${tillTimeLabel}`;

    return sendSuccessResponse(res, 201, 'Taxi driver pre-approval created successfully', {
      data: {
        preApprovalId: approval.preApprovalId,
        category: 'Taxi',
        visitorType: 'Taxi',
        company: {
          id: resolvedCompany.id || null,
          name: resolvedCompany.name,
          imageUrl: resolvedCompany.imageUrl || null,
        },
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
        vehicleNumber: approval.vehicleNumber || null,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to create taxi driver pre-approval'));
  }
};

module.exports = {
  createTaxiDriverPreApproval,
};
