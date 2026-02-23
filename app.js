const express = require('express');
const path = require('path');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFoundHandler');
const config = require('./config/appConfig');
const { sendSuccessResponse } = require('./utils/response');

const app = express();

const corsOptions =
  config.cors?.origins && config.cors.origins.length > 0
    ? { origin: config.cors.origins, credentials: true }
    : undefined;

app.use(cors(corsOptions));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) =>
  sendSuccessResponse(res, 200, 'Gatepal API is up and running')
);


app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
