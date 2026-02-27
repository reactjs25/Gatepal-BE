const { sendSuccessResponse } = require('../../utils/response');
const { setErrorDefaults, createHttpError } = require('../../utils/httpError');
const {
  generateAndUploadVisitorLogReport,
  normalizeFilter,
} = require('../../service/report/visitorLogReportService');

const isSocietyAdminPrincipal = (req, appUser) => {
  if (req?.user?.effectiveRole === 'society_admin') return true;
  return String(appUser?.role || '').toLowerCase() === 'society_admin';
};

const resolveSocietyId = (req) => {
  const appUser = req.appUser;
  return req.user?.societyId || appUser?.societyId || appUser?.adminSocietyId || null;
};

const generateVisitorLogExcelReport = async (req, res, next) => {
  try {
    if (!req.appUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, req.appUser)) {
      return next(createHttpError('Only society admins can generate visitor log reports.', 403));
    }

    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return next(createHttpError('Society not found for this user.', 400));
    }

    const requestedFilter = req.body?.filter || req.query?.filter;
    const filter = normalizeFilter(requestedFilter);

    const report = await generateAndUploadVisitorLogReport({
      societyId,
      filter,
    });

    return sendSuccessResponse(res, 200, 'Visitor log report generated successfully.', {
      url: report.url,
      key: report.key,
      count: report.count,
      filter: report.filter,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to generate visitor log report.'));
  }
};

module.exports = {
  generateVisitorLogExcelReport,
};
