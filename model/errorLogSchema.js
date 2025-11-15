const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema(
  {
    apiEndpoint: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    statusCode: {
      type: Number,
    },
    errorMessage: {
      type: String,
      required: true,
      trim: true,
    },
    errorStack: {
      type: String,
    },
    requestBody: {
      type: mongoose.Schema.Types.Mixed,
    },
    requestQuery: {
      type: mongoose.Schema.Types.Mixed,
    },
    requestParams: {
      type: mongoose.Schema.Types.Mixed,
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
    },
    userContext: {
      type: mongoose.Schema.Types.Mixed,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    tags: {
      type: [String],
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ErrorLog', errorLogSchema);


