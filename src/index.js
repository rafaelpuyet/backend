const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const publicRoutes = require('./routes/public');
const userRoutes = require('./routes/user');
const appointmentRoutes = require('./routes/appointments');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { cleanupUnverifiedUsers, precalculateAvailableSlots, cleanupAuditLogs } = require('./utils/cron');

const prisma = new PrismaClient();
const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || ['http://localhost:3001', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());

// Rutas
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/public', publicRoutes);
app.use('/user', userRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Cron Jobs
cron.schedule('0 * * * *', cleanupUnverifiedUsers); // Hourly cleanup
cron.schedule('0 0 * * *', precalculateAvailableSlots); // Daily slot calculation
cron.schedule('0 0 1 * *', cleanupAuditLogs); // Monthly audit log cleanup

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));