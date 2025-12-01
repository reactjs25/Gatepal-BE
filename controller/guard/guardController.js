const Society = require('../../model/societySchema');
const { sendSuccessResponse } = require('../../utils/response');
const { setErrorDefaults } = require('../../utils/httpError');

const getAllSociety = async (req, res, next) => {
  try {
    const societies = await Society.find({}, 'societyName societyPin city country structure').lean();
    const mapped = societies.map((s) => {
      const wings = Array.isArray(s.structure) ? s.structure : [];
      const normalizedWings = wings.map((w) => {
        const units = Array.isArray(w.units) ? w.units : [];
        const normalizedUnits = units.map((u) => ({
          id: String(u._id),
          unitNumber: u.unitNumber,
        }));
        const totalUnits =
          typeof w.totalUnits === 'number' ? w.totalUnits : normalizedUnits.length;
        return {
          id: String(w._id),
          name: w.wingName,
          totalUnits,
          units: normalizedUnits,
        };
      });
      return {
        id: String(s._id),
        name: s.societyName,
        pin: s.societyPin,
        city: s.city,
        country: s.country,
        wings: normalizedWings,
      };
    });
    return sendSuccessResponse(res, 200, 'Societies fetched successfully', { data: mapped });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch societies'));
  }
};

module.exports = {
  getAllSociety,
};
