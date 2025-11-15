const mongoose = require('mongoose');
const { logError } = require('../utils/errorLogger');
const { sendSystemAlertEmail } = require('../utils/systemAlertEmail');

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

const buildHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
};

const healthCheck = async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = mapReadyState(dbState);
  const isHealthy = dbState === 1;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'ok' : 'degraded',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
};

const logTestError = async (req, res, next) => {
  try {
    const diagnosticError = buildHttpError('Manual diagnostic error log', 500);

    await logError({
      req,
      error: diagnosticError,
      statusCode: 500,
      tags: ['manual', 'diagnostic'],
      context: req.user
        ? { id: req.user.id, email: req.user.email, role: req.user.role }
        : { source: 'system-route' },
    });

    res.status(202).json({
      success: true,
      message: 'Diagnostic error recorded. Check error logs table for entry.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to record diagnostic error';
    next(error);
  }
};

const triggerAlertEmail = async (req, res, next) => {
  try {
    const { subject, message } = req.body || {};

    if (!message) {
      return next(buildHttpError('Message is required to trigger an alert email', 400));
    }

    await sendSystemAlertEmail({
      subject: subject || 'Gatepal Diagnostic Alert',
      text: message,
      html: `<p>${message}</p><p>Timestamp: ${new Date().toISOString()}</p>`,
    });

    res.status(202).json({
      success: true,
      message: 'Alert email has been queued via SMTP transporter.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to send diagnostic alert email';
    next(error);
  }
};

module.exports = {
  healthCheck,
  logTestError,
  triggerAlertEmail,
};

