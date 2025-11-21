const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFoundHandler');
const config = require('./config/appConfig');

const app = express();

const corsOptions =
  config.cors?.origins && config.cors.origins.length > 0
    ? { origin: config.cors.origins, credentials: true }
    : undefined;

app.use(cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Gatepal API is up and running');
});

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;