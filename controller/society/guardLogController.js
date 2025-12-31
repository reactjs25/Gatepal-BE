const GuardDutyLog = require('../../model/guardDutyLogSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { toISTDateTimeLabel } = require('../../utils/dateTime');

const getGuardLogs = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

  
    const societyId = req.user?.societyId || user.societyId;
    if (!societyId) {
      return next(createHttpError('Society not found for this admin', 400));
    }

    const { filter } = req.body || {};

 
    const now = new Date();
    let startDate;

    switch (filter) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'past_3_months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1, 0, 0, 0, 0);
        break;
      default:
    
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }

    const logs = await GuardDutyLog.find({
      societyId,
      logTime: { $gte: startDate },
    })
      .sort({ logTime: -1 })
      .lean();

    const formattedLogs = logs.map((log) => ({
      id: String(log._id),
      guardId: String(log.guardId),
      guardName: log.guardName,
      logTime: toISTDateTimeLabel(log.logTime),
      logType: log.logType === 'duty_start' ? 'Duty Start' : 'Duty End',
      gateName: log.gateName || null,
    }));

    return sendSuccessResponse(res, 200, 'Guard logs fetched successfully', {
      data: formattedLogs,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch guard logs'));
  }
};

module.exports = {
  getGuardLogs,
};
