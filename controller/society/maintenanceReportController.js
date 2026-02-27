const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const {
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
} = require('../../utils/adminSocietyContext');
const {
  generateAndUploadMaintenanceReport,
  normalizeMonth,
  normalizeYear,
  normalizeStatusFilter,
} = require('../../service/report/maintenanceReportService');

const generateMaintenanceExcelReport = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can generate maintenance reports.', 403));
    }

    const society = await resolveAdminSocietyFromContext({ req, authUser });
    if (!society?._id) {
      return next(createHttpError('Society not found.', 404));
    }

    const monthInput = req.body?.month ?? req.query?.month;
    const yearInput = req.body?.year ?? req.query?.year;
    const statusInput = req.body?.status ?? req.query?.status;

    const month = normalizeMonth(monthInput);
    const year = normalizeYear(yearInput);
    const status = normalizeStatusFilter(statusInput);

    const report = await generateAndUploadMaintenanceReport({
      societyId: String(society._id),
      month,
      year,
      status,
    });

    return sendSuccessResponse(res, 200, 'Maintenance report generated successfully.', {
      url: report.url,
      key: report.key,
      count: report.count,
      status: report.status,
      month: report.month,
      year: report.year,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to generate maintenance report.'));
  }
};

module.exports = {
  generateMaintenanceExcelReport,
};
