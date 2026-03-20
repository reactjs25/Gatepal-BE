const { logError } = require('../utils/errorLogger');
const { localizeResponseMessage } = require('../utils/responseMessageLocalization');

  
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

  const message = localizeResponseMessage(
    err.publicMessage || err.message || 'Internal server error',
    req,
    res
  );

  res.status(safeStatus).json({
    statusCode: safeStatus,
    success: false,
    message,
    ...(err.details !== undefined ? { details: err.details } : {}),
    timestamp: new Date().toISOString(),
  });
};

module.exports = errorHandler;






