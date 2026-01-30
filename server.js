const http = require('http');
const app = require('./app');
const config = require('./config/appConfig');
const connectToDb = require('./connectToDb/connectToDb');
const MemberUnit = require('./model/memberUnitSchema');
const { initializeFirebase } = require('./config/firebaseConfig');
const { expireVisitorStatuses } = require('./utils/expireVisitorStatuses');

const startServer = async () => {
  try {
    await connectToDb({
      uri: config.database.uri,
      alertDebounceMs: config.database.alertDebounceMs,
    });

    await MemberUnit.syncIndexes();
    
    
    initializeFirebase();
    
    const EXPIRY_INTERVAL_MS = 5 * 60 * 1000;
    const runExpiryJob = async () => {
      try {
        await expireVisitorStatuses();
      } catch (error) {
        console.error('Expiry job failed:', error.message);
      }
    };
    await runExpiryJob();
    setInterval(runExpiryJob, EXPIRY_INTERVAL_MS);

    const server = http.createServer(app);

    server.listen(config.server.port, () => {
      console.log(`Server is running on port ${config.server.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
