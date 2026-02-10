const { ACTION_TYPES, ACTION_REASONS } = require('../utils/enums/actionReasonEnums');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');

const getActionReasons = async (req, res, next) => {
  try {
    const { actionType } = req.query;

    if (!actionType) {
      throw createHttpError('actionType query parameter is required.', 400);
    }

    if (!ACTION_TYPES.includes(actionType)) {
      throw createHttpError(
        `Invalid actionType. Must be one of: ${ACTION_TYPES.join(', ')}`,
        400
      );
    }

    const reasons = ACTION_REASONS[actionType].map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
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
