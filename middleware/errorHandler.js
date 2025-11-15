const { logError } = require('../utils/errorLogger');

// eslint-disable-next-line no-unused-vars
const errorHandler = async (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const safeStatus = Number.isInteger(statusCode) ? statusCode : 500;

  await logError({
    req,
    error: err,
    statusCode: safeStatus,
    context: req?.user
      ? {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
        }
      : undefined,
  });

  if (res.headersSent) {
    return;
  }

  res.status(safeStatus).json({
    success: false,
    message: err.publicMessage || err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
  });
};

module.exports = errorHandler;


