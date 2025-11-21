const { createHttpError } = require('../utils/httpError');

const notFoundHandler = (req, res, next) => {
  next(createHttpError(`Route ${req.originalUrl} not found`, 404));
};

module.exports = notFoundHandler;

