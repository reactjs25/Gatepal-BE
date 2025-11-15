const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectToDb = require('./connectToDb/connectToDb');
const authRoutes = require('./routes/authRoutes');
const societyRoutes = require('./routes/societyRoutes');
const societyAdminRoutes = require('./routes/societyAdminRoutes');
const systemRoutes = require('./routes/systemRoutes');
const errorHandler = require('./middleware/errorHandler');

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

connectToDb();

app.get('/', (req, res) => {
  res.send('Gatepal API is up and running');
});

app.use('/api/auth', authRoutes);
app.use('/api/society', societyRoutes);
app.use('/api/society-admin', societyAdminRoutes);
app.use('/api/system', systemRoutes);

app.use((req, res, next) => {
  const notFoundError = new Error(`Route ${req.originalUrl} not found`);
  notFoundError.statusCode = 404;
  next(notFoundError);
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});