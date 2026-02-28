const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const {
  isSocietyAdminPrincipal,
  resolveAdminSocietyFromContext,
} = require('../../utils/adminSocietyContext');
const { generateAndUploadVehicleReport } = require('../../service/report/vehicleReportService');

const generateVehicleExcelReport = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    if (!authUser) {
      return next(createHttpError('Unauthorized.', 401));
    }

    if (!isSocietyAdminPrincipal(req, authUser)) {
      return next(createHttpError('Only society admins can generate vehicle reports.', 403));
    }

    const society = await resolveAdminSocietyFromContext({ req, authUser });
    if (!society?._id) {
      return next(createHttpError('Society not found.', 404));
    }

    const report = await generateAndUploadVehicleReport({
      societyId: String(society._id),
    });

    return sendSuccessResponse(res, 200, 'Vehicle report generated successfully.', {
      url: report.url,
      count: report.count,
      generatedAt: report.generatedAt,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to generate vehicle report.'));
  }
};

module.exports = {
  generateVehicleExcelReport,
};
