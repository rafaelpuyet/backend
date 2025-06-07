const express = require('express');
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

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

// Rutas
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/public', publicRoutes);
app.use('/user', userRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Cron job: Limpiar usuarios no verificados (cada hora)
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running user cleanup job');
    await prisma.user.deleteMany({
      where: {
        isVerified: false,
        verificationTokens: {
          some: { expiresAt: { lt: new Date() } },
        },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
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
        createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      },
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
      include: { schedules: true, exceptions: true, appointments: true },
    });
    for (const business of businesses) {
      const timezone = business.timezone || 'America/Santiago';
      const today = moment.tz(timezone).startOf('day');
      const endDate = today.clone().add(30, 'days'); // Calcular para 30 días
      await prisma.availableSlots.deleteMany({
        where: { businessId: business.id, date: { gte: today.toDate() } },
      });
      for (const schedule of business.schedules) {
        const slots = generateSlots(schedule, today, endDate, business.exceptions, business.appointments, timezone);
        if (slots.length > 0) {
          await prisma.availableSlots.createMany({ data: slots });
        }
      }
    }
    console.log('AvailableSlots calculation completed');
  } catch (err) {
    console.error('AvailableSlots calculation failed:', err);
  }
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
      const { sendEmail } = require('./utils/email');
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

function generateSlots(schedule, startDate, endDate, exceptions, appointments, timezone) {
  const slots = [];
  let currentDate = startDate.clone();
  while (currentDate.isSameOrBefore(endDate, 'day')) {
    if (schedule.dayOfWeek === currentDate.day()) {
      let start = moment.tz(`${currentDate.format('YYYY-MM-DD')} ${schedule.startTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
      const end = moment.tz(`${currentDate.format('YYYY-MM-DD')} ${schedule.endTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
      while (start.isBefore(end)) {
        const slotEnd = start.clone().add(schedule.slotDuration, 'minutes');
        const isBlocked = exceptions.some((e) => {
          const exceptionDate = moment.tz(e.date, timezone);
          return (
            exceptionDate.isSame(currentDate, 'day') &&
            (e.isClosed ||
              (e.startTime &&
                e.endTime &&
                start.isSameOrAfter(moment.tz(`${exceptionDate.format('YYYY-MM-DD')} ${e.startTime}`, 'YYYY-MM-DD HH:mm:ss', timezone)) &&
                start.isBefore(moment.tz(`${exceptionDate.format('YYYY-MM-DD')} ${e.endTime}`, 'YYYY-MM-DD HH:mm:ss', timezone))))
          );
        });
        const isBooked = appointments.some((a) =>
          moment(a.startTime).tz(timezone).isSame(start, 'minute') && a.status !== 'cancelled'
        );
        if (!isBlocked && !isBooked) {
          slots.push({
            businessId: schedule.businessId,
            branchId: schedule.branchId || null,
            workerId: schedule.workerId || null,
            date: currentDate.toDate(),
            startTime: start.format('HH:mm:ss'),
            endTime: slotEnd.format('HH:mm:ss'),
          });
        }
        start.add(schedule.slotDuration, 'minutes');
      }
    }
    currentDate.add(1, 'day');
  }
  return slots;
}

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
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