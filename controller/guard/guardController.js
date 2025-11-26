const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { setErrorDefaults } = require('../../utils/httpError');

const getAllSociety = async (req, res, next) => {
  try {
    const societies = await Society.find({}, 'societyName societyPin city country').lean();
    return sendSuccessResponse(res, 200, 'Societies fetched successfully', { data: societies });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch societies'));
  }
};

module.exports = {
  getAllSociety,
};
