const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { appointmentSchema } = require('../utils/validation');
const { businessLimiter, availabilityLimiter, appointmentLimiter } = require('../middleware/rateLimit');
const { sendEmail } = require('../utils/email');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/business/:username', businessLimiter, async (req, res, next) => {
  try {
    const username = req.params.username.toLowerCase();
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'Business not found' });

    const business = await prisma.business.findFirst({
      where: { userId: user.id },
      select: { id: true, name: true, logo: true, isBusiness: true }
    });

    let branches = [];
    if (user.isBusiness) {
      branches = await prisma.branch.findMany({
        where: { businessId: business.id },
        select: { id: true, name: true, address: true }
      });
      if (branches.length === 0) return res.status(400).json({ error: 'No branches configured' });
    }

    res.json({
      business: { id: business.id, name: business.name, logo: business.logo, isBusiness: user.isBusiness },
      branches: branches.length === 1 ? branches : branches
    });
  } catch (err) {
    next(err);
  }
});

router.get('/business/:username/availability', availabilityLimiter, async (req, res, next) => {
  try {
    const { branchId, workerId, date } = req.query;
    const username = req.params.username.toLowerCase();
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'Business not found' });

    const business = await prisma.business.findFirst({ where: { userId: user.id } });
    if (branchId && !user.isBusiness) return res.status(400).json({ error: 'Not a business account' });

    const parsedDate = new Date(date);
    if (isNaN(parsedDate)) return res.status(400).json({ error: 'Invalid date' });

    const schedules = await prisma.schedule.findMany({
      where: {
        businessId: business.id,
        branchId: branchId ? parseInt(branchId) : undefined,
        workerId: workerId ? parseInt(workerId) : undefined,
        dayOfWeek: parsedDate.getDay()
      }
    });

    const exceptions = await prisma.exception.findMany({
      where: {
        businessId: business.id,
        branchId: branchId ? parseInt(branchId) : undefined,
        workerId: workerId ? parseInt(workerId) : undefined,
        date: parsedDate
      }
    });

    const appointments = await prisma.appointment.findMany({
      where: {
        businessId: business.id,
        branchId: branchId ? parseInt(branchId) : undefined,
        workerId: workerId ? parseInt(workerId) : undefined,
        startTime: {
          gte: new Date(parsedDate.setHours(0, 0, 0, 0)),
          lt: new Date(parsedDate.setHours(23, 59, 59, 999))
        },
        status: { not: 'cancelled' }
      }
    });

    let availableSlots = [];
    schedules.forEach(schedule => {
      let currentTime = new Date(`2023-01-01T${schedule.startTime}`);
      const endTime = new Date(`2023-01-01T${schedule.endTime}`);
      while (currentTime < endTime) {
        const slotEnd = new Date(currentTime.getTime() + schedule.slotDuration * 60 * 1000);
        if (
          !exceptions.some(exc => exc.isClosed || (exc.startTime <= slotEnd && exc.endTime >= currentTime)) &&
          !appointments.some(appt => appt.startTime <= slotEnd && appt.endTime >= currentTime)
        ) {
          availableSlots.push({
            startTime: currentTime.toISOString(),
            endTime: slotEnd.toISOString(),
            workerId: schedule.workerId,
            workerName: schedule.worker ? schedule.worker.workerName : null
          });
        }
        currentTime = slotEnd;
      }
    });

    res.json({ availableSlots });
  } catch (err) {
    next(err);
  }
});

router.post('/business/:username/appointments', appointmentLimiter, async (req, res, next) => {
  try {
    const { error } = appointmentSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { branchId, workerId, startTime, endTime, clientName, clientEmail, clientPhone } = req.body;
    const username = req.params.username.toLowerCase();
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'Business not found' });

    const business = await prisma.business.findFirst({ where: { userId: user.id } });
    if (branchId && !user.isBusiness) return res.status(400).json({ error: 'Not a business account' });

    const appointment = await prisma.$transaction(async (tx) => {
      const slotTaken = await tx.appointment.findFirst({
        where: {
          businessId: business.id,
          startTime: new Date(startTime),
          status: { not: 'cancelled' }
        }
      });
      if (slotTaken) throw new Error('Slot taken');

      return tx.appointment({
        data: {
          businessId: business.id,
          branchId,
          workerId,
          clientName,
          clientEmail,
          clientPhone,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          status: 'pending'
        }
      });
    });

    await sendEmail(clientEmail, 'Appointment Confirmation', `Your appointment is confirmed for ${startTime}.`);
    await prisma.auditLog.create({
      data: { action: 'create', entity: 'Appointment', entityId: appointment.id }
    });

    res.json({ message: 'Appointment created', appointmentId: appointment.id });
  } catch (err) {
    next(err);
  }
});

router.put('/appointments/:id', appointmentLimiter, async (req, res, next) => {
  try {
    const { token, startTime, endTime } = req.body;
    const appointmentId = parseInt(req.params.id);

    const tempToken = await prisma.temporaryToken.findUnique({
      where: { token, used: false, expiresAt: { gt: new Date() } }
    });
    if (!tempToken || tempToken.appointmentId !== appointmentId) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.clientEmail !== tempToken.clientEmail) {
      return res.status(400).json({ error: 'Invalid appointment' });
    }

    if (startTime && endTime) {
      const slotTaken = await prisma.appointment.findFirst({
        where: {
          businessId: appointment.businessId,
          startTime: new Date(startTime),
          status: { not: 'cancelled' },
          id: { not: appointmentId }
        }
      });
      if (slotTaken) return res.status(400).json({ error: 'Slot taken' });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        status: 'pending'
      }
    });

    await prisma.temporaryToken.update({
      where: { token },
      data: { used: true }
    });

    await prisma.auditLog.create({
      data: { action: 'update', entity: 'Appointment', entityId: appointmentId }
    });

    res.json({ message: 'Appointment updated' });
  } catch (err) {
    next(err);
  }
});

router.delete('/appointments/:id', appointmentLimiter, async (req, res, next) => {
  try {
    const { token } = req.body;
    const appointmentId = parseInt(req.params.id);

    const tempToken = await prisma.temporaryToken.findUnique({
      where: { token, used: false, expiresAt: { gt: new Date() } }
    });
    if (!tempToken || tempToken.appointmentId !== appointmentId) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.clientEmail !== tempToken.clientEmail) {
      return res.status(400).json({ error: 'Invalid appointment' });
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'cancelled' }
    });

    await prisma.temporaryToken.update({
      where: { token },
      data: { used: true }
    });

    await sendEmail(appointment.clientEmail, 'Appointment Cancelled', `Your appointment has been cancelled.`);
    await prisma.auditLog.create({
      data: { action: 'update', entity: 'Appointment', entityId: appointmentId }
    });

    res.json({ message: 'Appointment cancelled' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;