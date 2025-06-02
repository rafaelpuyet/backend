// server/src/index.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const { registerLimiter } = require('./middleware/rateLimit');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json()); // Ensure JSON parsing before routes

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);

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