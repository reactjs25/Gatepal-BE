const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const {
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
} = require('../../utils/adminSocietyContext');
const { generateAndUploadUnitListReport } = require('../../service/report/unitListReportService');

const generateUnitListExcelReport = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can generate unit list reports.', 403));
    }

    const society = await resolveAdminSocietyFromContext({ req, authUser });
    if (!society?._id) {
      return next(createHttpError('Society not found.', 404));
    }

    const report = await generateAndUploadUnitListReport({
      societyId: String(society._id),
    });

    return sendSuccessResponse(res, 200, 'Unit list report generated successfully.', {
      url: report.url,
      key: report.key,
      count: report.count,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to generate unit list report.'));
  }
};

module.exports = {
  generateUnitListExcelReport,
};
