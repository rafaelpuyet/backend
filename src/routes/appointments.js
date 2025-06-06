const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { appointmentUpdateSchema } = require('../utils/validation');
const authenticate = require('../middleware/authenticate');
const { sendEmail } = require('../utils/email');

const prisma = new PrismaClient();
const router = express.Router();

const validTransitions = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  cancelled: []
};

router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { error } = appointmentUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { startTime, endTime, status } = req.body;
    const appointmentId = parseInt(req.params.id);
    const userId = req.user.userId;

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    const business = await prisma.business.findFirst({ where: { userId } });
    if (appointment.businessId !== business.id) return res.status(403).json({ error: 'Unauthorized' });

    if (status && !validTransitions[appointment.status].includes(status)) {
      return res.status(400).json({ error: `Invalid status transition from ${appointment.status} to ${status}` });
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
        status
      }
    });

    if (status === 'cancelled' || startTime || endTime) {
      await sendEmail(updatedAppointment.clientEmail, 'Appointment Updated', `Your appointment has been ${status || 'rescheduled'}.`);
    }

    await prisma.auditLog.create({
      data: { action: 'update', entity: 'Appointment', entityId: appointmentId, userId }
    });

    res.json({ token: req.headers.authorization.split(' ')[1] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;