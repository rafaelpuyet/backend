const express = require('express');
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const publicRoutes = require('./routes/public');
const userRoutes = require('./routes/user');
const appointmentRoutes = require('./routes/appointments');

const prisma = new PrismaClient();
const app = express();

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(express.json());

// Rutas
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/public', publicRoutes);
app.use('/user', userRoutes);
app.use('/appointments', appointmentRoutes);

// Cron job: Limpiar usuarios no verificados (cada hora)
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running user cleanup job');
    await prisma.user.deleteMany({
      where: {
        isVerified: false,
        verificationTokens: {
          some: { expiresAt: { lt: new Date() } }
        },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    });
    console.log('User cleanup completed');
  } catch (err) {
    console.error('User cleanup failed:', err);
  }
});

// Cron job: Limpiar AuditLog > 90 días (mensual)
cron.schedule('0 0 1 * *', async () => {
  try {
    console.log('Running AuditLog cleanup job');
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
      }
    });
    console.log('AuditLog cleanup completed');
  } catch (err) {
    console.error('AuditLog cleanup failed:', err);
  }
});

// Cron job: Precalcular AvailableSlots (diario a medianoche)
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running AvailableSlots calculation job');
    const businesses = await prisma.business.findMany({
      include: { schedules: true, exceptions: true, appointments: true }
    });
    for (const business of businesses) {
      const timezone = business.timezone || 'UTC';
      const today = moment.tz(timezone).startOf('day');
      const tomorrow = today.clone().add(1, 'day');
      await prisma.availableSlots.deleteMany({
        where: { businessId: business.id, date: { gte: tomorrow.toDate() } }
      });
      for (const schedule of business.schedules) {
        const slots = generateSlots(schedule, tomorrow, business.exceptions, business.appointments, timezone);
        await prisma.availableSlots.createMany({ data: slots });
      }
    }
    console.log('AvailableSlots calculation completed');
  } catch (err) {
    console.error('AvailableSlots calculation failed:', err);
  }
});

function generateSlots(schedule, date, exceptions, appointments, timezone) {
  const slots = [];
  const start = moment.tz(`${date.format('YYYY-MM-DD')} ${schedule.startTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
  const end = moment.tz(`${date.format('YYYY-MM-DD')} ${schedule.endTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
  while (start.isBefore(end)) {
    const slotEnd = start.clone().add(schedule.slotDuration, 'minutes');
    const isAvailable = !exceptions.some(e => 
      moment.tz(e.date, timezone).isSame(date, 'day') &&
      (e.isClosed || (e.startTime && e.endTime && start.isBetween(e.startTime, e.endTime)) &&
      !appointments.some(a => a.startTime >= start.toDate() && a.endTime <= slotEnd.toDate() && a.status !== 'cancelled')
    );
    if (isAvailable) {
      slots.push({
        businessId: schedule.businessId,
        branchId: schedule.branchId,
        workerId: schedule.workerId,
        date: date.toDate(),
        startTime: start.format('HH:mm:ss'),
        endTime: slotEnd.format('HH:mm:ss'),
      });
    }
    start.add(schedule.slotDuration, 'minutes');
  }
  return slots;
}

// Manejo de errores
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Cierre graceful
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing server...');
  await prisma.$disconnect();
  process.exit(0);
});

// Cron job: Enviar recordatorios 24 horas antes (diario a medianoche)
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running appointment reminder job');
    const tomorrow = moment().add(1, 'day').startOf('day');
    const appointments = await prisma.appointment.findMany({
      where: {
        startTime: {
          gte: tomorrow.toDate(),
          lt: tomorrow.clone().endOf('day').toDate(),
        },
        status: { in: ['pending', 'confirmed'] },
      },
      include: { business: true },
    });

    for (const appointment of appointments) {
      await sendEmail({
        to: appointment.clientEmail,
        subject: 'Recordatorio de Cita',
        template: 'reminder',
        data: {
          businessName: appointment.business.name,
          date: moment(appointment.startTime).format('DD-MM-YYYY'),
          time: moment(appointment.startTime).format('HH:mm'),
        },
      });
    }
    console.log('Appointment reminder job completed');
  } catch (err) {
    console.error('Appointment reminder job failed:', err);
  }
});