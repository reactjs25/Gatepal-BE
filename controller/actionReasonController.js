const { ACTION_TYPES, VISITOR_TYPES, ACTION_REASONS } = require('../utils/enums/actionReasonEnums');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');

const getActionReasons = async (req, res, next) => {
  try {
    const { actionType, visitorType } = req.query;

    if (!actionType) {
      throw createHttpError('actionType query parameter is required.', 400);
    }

    if (!ACTION_TYPES.includes(actionType)) {
      throw createHttpError(
        `Invalid actionType. Must be one of: ${ACTION_TYPES.join(', ')}`,
        400
      );
    }

    if (!visitorType) {
      throw createHttpError('visitorType query parameter is required.', 400);
    }

    if (!VISITOR_TYPES.includes(visitorType)) {
      throw createHttpError(
        `Invalid visitorType. Must be one of: ${VISITOR_TYPES.join(', ')}`,
        400
      );
    }

    const reasonsList = ACTION_REASONS[actionType]?.[visitorType] || [];

    const reasons = reasonsList.map((name) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, ''),
      name,
    }));

    return sendSuccessResponse(res, 200, 'Action reasons fetched successfully.', {
      data: reasons,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch action reasons'));
  }
};

module.exports = {
  getActionReasons,
};
