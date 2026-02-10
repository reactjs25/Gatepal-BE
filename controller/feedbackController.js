const Feedback = require('../model/feedbackSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');

const submitFeedback = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    const { rating, description } = req.body;

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      throw createHttpError('Rating is required and must be an integer between 1 and 5', 400);
    }

    if (description && typeof description !== 'string') {
      throw createHttpError('Description must be a string', 400);
    }

    if (description && description.length > 1000) {
      throw createHttpError('Description must not exceed 1000 characters', 400);
    }

    const role = req.user.effectiveRole || user.role;

    const feedback = new Feedback({
      userId: user._id,
      role,
      rating,
      description: description ? description.trim() : '',
    });

    await feedback.save();

    const feedbackData = feedback.toObject();
    delete feedbackData.createdAt;
    delete feedbackData.updatedAt;
    delete feedbackData.__v;

    return sendSuccessResponse(res, 201, 'Thank you for your feedback.', {
      data: feedbackData,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to submit feedback'));
  }
};

module.exports = { submitFeedback };
