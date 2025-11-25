const mongoose = require('mongoose');
const { createHttpError } = require('../../utils/httpError');
const Society = require('../../model/societySchema');

const assertObjectId = (value, message) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(message, 400);
  }
};

const handleGuardOnboarding = async ({ user, payload }) => {
  const { fullName, email, societyId, assignedGate, shiftStart, shiftEnd, notes } = payload;

  if (!fullName) {
    throw createHttpError('Full name is required for guard onboarding', 400);
  }

  let society = null;

  if (societyId) {
    assertObjectId(societyId, 'Invalid society identifier provided');
    society = await Society.findById(societyId);
    if (!society) {
      throw createHttpError('Society not found', 404);
    }
  }

  user.fullName = fullName.trim();
  user.email = email?.trim().toLowerCase() || user.email;
  user.societyId = society ? society._id : null;
  user.societyName = society ? society.societyName : null;
  user.onboardingData = {
    ...(user.onboardingData || {}),
    guard: {
      fullName: user.fullName,
      email: user.email,
      societyId: society ? society._id : null,
      societyName: society ? society.societyName : null,
      assignedGate: assignedGate || null,
      shiftStart: shiftStart || null,
      shiftEnd: shiftEnd || null,
      notes: notes || null,
    },
  };

  return { society };
};

module.exports = {
  handleGuardOnboarding,
};

