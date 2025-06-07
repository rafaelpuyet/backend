const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const schemas = require('../utils/validation');
const authenticate = require('../middleware/authenticate');
const { sendEmail } = require('../utils/email');
const moment = require('moment-timezone');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

// PUT /appointments/:id
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateAppointment.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const appointmentId = parseInt(req.params.id);
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new Error('Appointment not found', { statusCode: 404 });

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business || appointment.businessId !== business.id) {
      throw new Error('Unauthorized', { statusCode: 401 });
    }

    const { startTime, endTime, status } = value;
    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['cancelled'],
      cancelled: [],
    };
    if (status && !validTransitions[appointment.status].includes(status)) {
      throw new Error('Invalid status transition', { statusCode: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (startTime && endTime) {
        const existing = await tx.appointment.findFirst({
          where: {
            businessId: business.id,
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
      } else if (status) {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Appointment',
          entityId: appointmentId,
          userId: req.user.userId,
        },
      });

      await sendEmail({
        to: appointment.clientEmail,
        subject: status === 'cancelled' ? 'Cita Cancelada' : 'Cita Actualizada',
        template: status === 'cancelled' ? 'cancellation' : 'confirmation',
        data: {
          businessName: business.name,
          date: moment(startTime || appointment.startTime).format('DD-MM-YYYY'),
          time: moment(startTime || appointment.startTime).format('HH:mm'),
          appointmentId,
          token: status !== 'cancelled' ? require('crypto').randomBytes(32).toString('hex') : undefined,
        },
      });
    });

    const token = jwt.sign(
      { userId: req.user.userId, isBusiness: req.user.isBusiness, username: req.user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// GET /audit-logs
router.get('/audit-logs', authenticate, async (req, res, next) => {
  try {
    const { entity, entityId, action, startDate, endDate } = req.query;
    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    const logs = await prisma.auditLog.findMany({
      where: {
        entity: entity || undefined,
        entityId: entityId ? parseInt(entityId) : undefined,
        action: action || undefined,
        createdAt: {
          gte: startDate ? new Date(startDate) : undefined,
          lte: endDate ? new Date(endDate) : undefined,
        },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;