const http = require('http');
const app = require('./app');
const config = require('./config/appConfig');
const connectToDb = require('./connectToDb/connectToDb');

const startServer = async () => {
  try {
    await connectToDb({
      uri: config.database.uri,
      alertDebounceMs: config.database.alertDebounceMs,
    });

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

