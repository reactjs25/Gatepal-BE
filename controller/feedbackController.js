const Feedback = require('../model/feedbackSchema');
const { sendSuccessResponse } = require('../utils/response');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const mongoose = require('mongoose');

const stripFeedback = (feedbackDoc) => {
  if (!feedbackDoc) return null;
  const obj = typeof feedbackDoc.toObject === 'function' ? feedbackDoc.toObject() : feedbackDoc;
  delete obj.createdAt;
  delete obj.updatedAt;
  delete obj.__v;
  return obj;
};

const dedupeUserFeedbacks = async (userId, keepId) => {
  if (!userId || !keepId) return;
  await Feedback.deleteMany({ userId, _id: { $ne: keepId } });
};

const parseAndValidateFeedbackBody = (body = {}) => {
  const rating = body.rating;
  const rawDescription =
    typeof body.description === 'string'
      ? body.description
      : typeof body.comment === 'string'
        ? body.comment
        : body.description ?? body.comment;

  if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw createHttpError('Rating is required and must be an integer between 1 and 5', 400);
  }

  if (typeof rawDescription !== 'string') {
    throw createHttpError('Comment is required and must be a string', 400);
  }

  const description = rawDescription.trim();
  if (!description) {
    throw createHttpError('Comment must not be empty', 400);
  }

  if (description.length > 1000) {
    throw createHttpError('Comment must not exceed 1000 characters', 400);
  }

  return { rating, description };
};

const getMyFeedback = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    const feedback = await Feedback.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
    if (feedback?._id) {
      await dedupeUserFeedbacks(user._id, feedback._id);
    }
    return sendSuccessResponse(res, 200, 'Feedback fetched.', {
      data: feedback ? stripFeedback(feedback) : null,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch feedback'));
  }
};

const submitFeedback = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    const { rating, description } = parseAndValidateFeedbackBody(req.body);

    const role = req.user?.effectiveRole || user.role;

    const existing = await Feedback.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (existing) {
      existing.rating = rating;
      existing.description = description;
      existing.role = role;
      await existing.save();
      await dedupeUserFeedbacks(user._id, existing._id);

      return sendSuccessResponse(res, 200, 'Feedback updated.', {
        data: stripFeedback(existing),
      });
    }

    try {
      const feedback = await Feedback.create({
        userId: user._id,
        role,
        rating,
        description,
      });

      return sendSuccessResponse(res, 201, 'Thank you for your feedback.', {
        data: stripFeedback(feedback),
      });
    } catch (e) {
      // If a duplicate got created due to a race, fall back to update.
      if (e?.code === 11000) {
        const doc = await Feedback.findOneAndUpdate(
          { userId: user._id },
          { $set: { rating, description, role } },
          { new: true, sort: { createdAt: -1 } }
        );
        if (doc?._id) {
          await dedupeUserFeedbacks(user._id, doc._id);
        }
        return sendSuccessResponse(res, 200, 'Feedback updated.', {
          data: stripFeedback(doc),
        });
      }
      throw e;
    }
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to submit feedback'));
  }
};

const updateFeedback = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw createHttpError('Invalid feedback id', 400);
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
      throw createHttpError('Feedback not found', 404);
    }

    if (String(feedback.userId) !== String(user._id)) {
      throw createHttpError('Forbidden: you can only update your own feedback', 403);
    }

    const { rating, description } = parseAndValidateFeedbackBody(req.body);

    feedback.rating = rating;
    feedback.description = description;
    await feedback.save();
    await dedupeUserFeedbacks(user._id, feedback._id);

    return sendSuccessResponse(res, 200, 'Feedback updated.', {
      data: stripFeedback(feedback),
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to update feedback'));
  }
};

module.exports = { submitFeedback, getMyFeedback, updateFeedback };
