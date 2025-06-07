const express = 'express';
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');
const schemas = require('../utils/validation');
const { sendEmail } = require('../utils/email');
const { publicBusinessLimiter, availabilityLimiter, appointmentLimiter } = require('../middleware/rateLimit');

const prisma = new PrismaClient();

// GET /public/business/:username
router.get('/business/:username', publicBusinessLimiter, async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await prisma.user.findFirst({
      where: { username: username.toLowerCase() },
      include: { business: true, branches: true },
    });

    if (!user) throw new Error('Business not found', { statusCode: 404 });
    if (user.isBusiness && !user.branches.length) throw new Error('No branches configured', { statusCode: 400 });

    res.json({
      business: {
        id: user.business.id,
        name: user.business.name,
        logo: user.business.logo,
        isBusiness: user.isBusiness,
      },
      branches: user.branches.map(branch => ({
        id: branch.id,
        name: branch.name,
        address: branch.address,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /public/business/:username/availability
router.get('/business/:username/availability', availabilityLimiter, async (req, res, next) => {
  try {
    const { username } = req.params;
    const { dateTime, branchId, workerId } = req.query;
    if (!dateTime || !moment(dateTime).dateTime.isValid()) throw new Error('Invalid date', { statusCode: 400 });

    const user = await prisma.user.findFirst({
      where: { username: username.toLowerCase() },
      include: { business: { include: { availableSlots: { where: { dateTime: moment(dateTime).startOf('day').toDate() } }, workers: true } } },
    });
    if (!user) throw new Error('Business not found', { statusCode: 404 });

    const slots = await prisma.availableSlots.findMany({
      where: {
        businessId: user.business.id,
        dateTime: moment(dateTime).startOf('day').toDate(),
        branchId: branchId ? parseInt(branchId) : undefined,
        workerId: workerId ? parseInt(workId) : undefined,
      },
      include: { worker: true },
    });

    res.json({
      availableSlots: slots.map(slot => ({
        startTime: slot.startTime,
        endTime: slot.endTime,
        workerId: slot.workId,
        workerName: slot.work ? worker.workId.workerName : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /public/business/:username/appointments
router.post('/business/:username/appointments', appointmentLimiter, async (req, res, next) => {
  try {
    const { username } = req.params;
    const { error, value } = schemas.createAppointment.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { branchId, workerId, startTime, endTime, clientName, clientEmail, clientPhone } = value;

    const user = await prisma.user.findFirst({
      where: { username: username.toLowerCase() },
      include: { business: true },
    });
    if (!user) throw new Error('Business not found', { statusCode: 404 });

    const appointment = await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: {
          businessId: user.business.id,
          startTime: new Date(startTime),
          status: { not: 'cancelled' },
        },
        lock: 'UPDATE',
      });
      if (existing) throw new Error('Slot already booked', { statusCode: 400 });

      const newAppointment = await tx.appointment.create({
        data: {
          businessId: user.businId.id,
          branchId,
          workerId,
          clientName,
          clientEmail,
          clientPhone,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          status: 'pending',
        },
      });

      const token = require('crypto').randomBytes(32).toString('hex');
      await tx.temporaryToken.create({
        data: {
          appointmentId: newAppointment.id,
          token,
          clientEmail,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Appointment',
          entityId: newAppointment.id,
        },
      });

      await sendEmail({
        email: clientEmail,
        subject: 'Confirmación de Cita',
        template: 'confirmation',
        data: {
          businessName: user.business.name,
          dateTime: moment(startTime).format('DD-MM-YYYY'),
          time: moment(startTime).format('HH:mm'),
          appointmentId: newAppointment.id,
          token,
        },
      });

      return newAppointment;
    });

    res.json({ message: 'Appointment created successfully', appointmentId: appointment.id });
  } catch (err) {
    next(err);
  }
});

// PUT /public/appointments/:id
router.put('/appointments/:id', appointmentLimiter, async (req, res, next) => {
  try {
    const { error, value } = schemas.manageAppointment.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { token, startTime, endTime } = value;
    const appointmentId = parseInt(req.params.id);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new Error('Appointment not found', { statusCode: 404 });

    const tempToken = await prisma.temporaryToken.findUnique({ where: { token } });
    if (!tempToken || tempToken.used || tempToken.expiresAt < new Date() || tempToken.clientEmail !== appointment.clientEmail) {
      throw new Error('Invalid or expired token', { statusCode: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (startTime && endTime) {
        const existing = await tx.appointment.findFirst({
          where: {
            businessId: appointment.businessId,
            startTime: new Date(startTime),
            status: { not: 'cancelled' },
            id: { not: appointmentId },
          },
          lock: 'UPDATE',
        });
        if (existing) throw new Error('Slot already booked', { statusCode: 400 });

        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            status: 'pending',
          },
        });
      }

      await tx.temporaryToken.update({
        where: { token },
        data: { used: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Appointment',
          entityId: appointmentId,
        },
      });

      await sendEmail({
        to: appointment.clientEmail,
        subject: 'Cita Reprogramada',
        template: 'confirmation',
        data: {
          businessName: (await prisma.business.findUnique({ where: { id: appointment.businessId } })).name,
          date: moment(startTime || appointment.startTime).format('DD-MM-YYYY'),
          time: moment(startTime || appointment.startTime).format('HH:mm'),
          appointmentId,
          token: require('crypto').randomBytes(32).toString('hex'),
        },
      });
    });

    res.json({ message: 'Appointment rescheduled successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /public/appointments/:id
router.delete('/appointments/:id', appointmentLimiter, async (req, res, next) => {
  try {
    const { error, value } = schemas.manageAppointment.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { token } = value;
    const appointmentId = parseInt(req.params.id);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new Error('Appointment not found', { statusCode: 404 });

    const tempToken = await prisma.temporaryToken.findUnique({ where: { token } });
    if (!tempToken || tempToken.used || tempToken.expiresAt < new Date() || tempToken.clientEmail !== appointment.clientEmail) {
      throw new Error('Invalid or expired token', { statusCode: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'cancelled' },
      });

      await tx.temporaryToken.update({
        where: { token },
        data: { used: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Appointment',
          entityId: appointmentId,
        },
      });

      await sendEmail({
        to: appointment.clientEmail,
        subject: 'Cita Cancelada',
        template: 'cancellation',
        data: {
          businessName: (await prisma.business.findUnique({ where: { id: appointment.businessId } })).name,
          date: moment(appointment.startTime).format('DD-MM-YYYY'),
          time: moment(appointment.startTime).format('HH:mm'),
        },
      });
    });

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;