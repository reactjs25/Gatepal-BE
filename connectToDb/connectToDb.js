const mongoose = require('mongoose');
const { logError } = require('../utils/errorLogger');
const { sendSystemAlertEmail } = require('../utils/systemAlertEmail');

const DEFAULT_ALERT_DEBOUNCE_MS = 15 * 60 * 1000;

let listenersRegistered = false;
let lastAlertTimestamp = 0;
let alertDebounceWindowMs = Number(process.env.DB_ALERT_DEBOUNCE_MS || DEFAULT_ALERT_DEBOUNCE_MS);

const setAlertDebounceWindow = (value) => {
  if (typeof value !== 'number') {
    return;
  }

  const normalized = Number(value);
  if (!Number.isNaN(normalized) && normalized >= 0) {
    alertDebounceWindowMs = normalized;
  }
};

const shouldSendAlert = () => {
  const now = Date.now();
  if (now - lastAlertTimestamp > alertDebounceWindowMs) {
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

const connectToDb = async (options = {}) => {
  const { uri = process.env.MONGO_URI, mongooseOptions = {}, alertDebounceMs } = options;

  if (!uri) {
    throw new Error('MongoDB connection string (MONGO_URI) is missing');
  }

  if (typeof alertDebounceMs === 'number') {
    setAlertDebounceWindow(alertDebounceMs);
  }

  try {
    await mongoose.connect(uri, mongooseOptions);
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

    throw error;
  }
};

module.exports = connectToDb;