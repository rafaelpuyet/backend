const express = require('express');
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const publicRoutes = require('./routes/public');
const userRoutes = require('./routes/user');
const appointmentRoutes = require('./routes/appointments');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

// Rutas
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/public', publicRoutes);
app.use('/user', userRoutes);
app.use('/appointments', appointmentRoutes);

// Cron job para limpieza (implementación inicial)
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running cleanup job');
    await prisma.user.deleteMany({
      where: {
        isVerified: false,
        verificationTokens: {
          some: {
            expiresAt: { lt: new Date() }
          }
        },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });
    console.log('Cleanup completed');
  } catch (err) {
    console.error('Cleanup job failed:', err);
  }
});

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing server...');
  await prisma.$disconnect();
  process.exit(0);
});