const mongoose = require('mongoose');
const { logError } = require('../utils/errorLogger');
const { sendSystemAlertEmail } = require('../utils/systemAlertEmail');
const { createHttpError, setErrorDefaults } = require('../utils/httpError');
const { sendSuccessResponse } = require('../utils/response');

const mapReadyState = (state) => {
  switch (state) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
};

const healthCheck = async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = mapReadyState(dbState);
  const isHealthy = dbState === 1;

  return sendSuccessResponse(res, isHealthy ? 200 : 503, isHealthy ? 'System is healthy' : 'System is degraded', {
    status: isHealthy ? 'ok' : 'degraded',
    database: dbStatus,
  });
};

const logTestError = async (req, res, next) => {
  try {
    const diagnosticError = createHttpError('Manual diagnostic error log', 500);

    await logError({
      req,
      error: diagnosticError,
      statusCode: 500,
      tags: ['manual', 'diagnostic'],
      context: req.user
        ? { id: req.user.id, email: req.user.email, role: req.user.role }
        : { source: 'system-route' },
    });

    return sendSuccessResponse(
      res,
      202,
      'Diagnostic error recorded. Check error logs table for entry.'
    );
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to record diagnostic error'));
  }
};

const triggerAlertEmail = async (req, res, next) => {
  try {
    const { subject, message } = req.body || {};

    if (!message) {
      return next(createHttpError('Message is required to trigger an alert email', 400));
    }

    await sendSystemAlertEmail({
      subject: subject || 'Gatepal Diagnostic Alert',
      text: message,
      html: `<p>${message}</p><p>Timestamp: ${new Date().toISOString()}</p>`,
    });

    return sendSuccessResponse(
      res,
      202,
      'Alert email has been queued via SMTP transporter.'
    );
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to send diagnostic alert email'));
  }
};



module.exports = {
  healthCheck,
  logTestError,
  triggerAlertEmail,
 };
