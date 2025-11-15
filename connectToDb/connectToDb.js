const mongoose = require('mongoose');
const { logError } = require('../utils/errorLogger');
const { sendSystemAlertEmail } = require('../utils/systemAlertEmail');

const ALERT_DEBOUNCE_MS = Number(process.env.DB_ALERT_DEBOUNCE_MS || 15 * 60 * 1000);

let listenersRegistered = false;
let lastAlertTimestamp = 0;

const shouldSendAlert = () => {
  const now = Date.now();
  if (now - lastAlertTimestamp > ALERT_DEBOUNCE_MS) {
    lastAlertTimestamp = now;
    return true;
  }
  return false;
};

const emitDbAlert = async ({ subject, message }) => {
  if (!shouldSendAlert()) {
    return;
  }

  try {
    await sendSystemAlertEmail({
      subject,
      text: message,
      html: `<p>${message}</p><p>Timestamp: ${new Date().toISOString()}</p>`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send database alert email:', error);
  }
};

const registerDatabaseListeners = () => {
  if (listenersRegistered) {
    return;
  }

  const connection = mongoose.connection;

  connection.on('error', async (error) => {
    await logError({
      error,
      statusCode: 500,
      apiEndpoint: 'mongo:connection',
      method: 'SYSTEM',
      context: { event: 'mongoose_error' },
    });

    await emitDbAlert({
      subject: 'Gatepal Alert: MongoDB connection error',
      message: `Mongoose reported a connection error.\n\nMessage: ${error.message}`,
    });
  });

  connection.on('disconnected', async () => {
    const error = new Error('MongoDB connection lost');
    error.statusCode = 503;

    await logError({
      error,
      statusCode: 503,
      apiEndpoint: 'mongo:connection',
      method: 'SYSTEM',
      context: { event: 'mongoose_disconnected' },
    });

    await emitDbAlert({
      subject: 'Gatepal Alert: MongoDB disconnected',
      message: 'MongoDB connection was lost. Services may be degraded.',
    });
  });

  connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log('MongoDB connection restored');
  });

  listenersRegistered = true;
};

const connectToDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    registerDatabaseListeners();
    console.log('Connected to MongoDB');
  } catch (error) {
    await logError({
      error,
      statusCode: 500,
      apiEndpoint: 'mongo:initial-connect',
      method: 'SYSTEM',
      context: { event: 'initial_connection_failure' },
    });

    await emitDbAlert({
      subject: 'Gatepal Alert: MongoDB connection failed',
      message: `Initial MongoDB connection failed.\n\nMessage: ${error.message}`,
    });

    process.exit(1);
  }
};

module.exports = connectToDb;