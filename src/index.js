// server/src/index.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const scheduleRoutes = require('./routes/schedules');
const profileRoutes = require('./routes/profile');
const serviceRoutes = require('./routes/services');
const { registerLimiter } = require('./middleware/rateLimit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

// Routes
app.use('/api/', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/services', serviceRoutes);

// Apply rate limiting to register endpoint
app.use('/api/auth/register', registerLimiter);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'API de TuApp funcionando' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Cerrando servidor...');
  process.exit(0);
});