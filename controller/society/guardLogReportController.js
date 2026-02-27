const { sendSuccessResponse } = require('../../utils/response');
const { setErrorDefaults, createHttpError } = require('../../utils/httpError');
const {
  generateAndUploadGuardsLogReport,
  normalizeFilter,
} = require('../../service/report/guardsLogReportService');

const resolveSocietyId = (req) => {
  const appUser = req.appUser;
  return req.user?.societyId || appUser?.societyId || appUser?.adminSocietyId || null;
};

const generateGuardLogExcelReport = async (req, res, next) => {
  try {
    if (!req.appUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return next(createHttpError('Society not found for this user.', 400));
    }

    const requestedFilter = req.body?.filter || req.query?.filter;
    const filter = normalizeFilter(requestedFilter);

    const report = await generateAndUploadGuardsLogReport({
      societyId,
      filter,
    });

    return sendSuccessResponse(res, 200, 'Guards log report generated successfully.', {
      url: report.url,
      key: report.key,
      count: report.count,
      filter: report.filter,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to generate guards log report.'));
  }
};

module.exports = {
  generateGuardLogExcelReport,
};
