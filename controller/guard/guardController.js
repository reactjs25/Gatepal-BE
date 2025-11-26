const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');

const getAllSociety = async (req, res, next) => {
  try {
    const societies = await Society.find({}, 'societyName societyPin city country');
    return sendSuccessResponse(res, 200, 'Societies fetched successfully', { data: societies });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch societies';
    next(error);
  }
};

module.exports = {
  getAllSociety,
};

