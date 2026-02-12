const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: ['member', 'society_admin', 'guard', 'visitor'],
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    description: {
      type: String,
      trim: true,
      required: true,
      minlength: 1,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

// Enforce one feedback per user (prevents duplicates at DB level).
feedbackSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
