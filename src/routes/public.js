const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const moment = require('moment-timezone');
const schemas = require('../utils/validation');
const { sendEmail } = require('../utils/email');
const crypto = require('crypto');
const { publicBusinessLimiter, availabilityLimiter, appointmentLimiter } = require('../middleware/rateLimit');

/**
 * @swagger
 * /public/business/{username}:
 *   get:
 *     summary: Obtener información pública de un negocio
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: username
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Business information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 business: { type: object }
 *                 branches: { type: array, items: { type: object } }
 *                 workers: { type: array, items: { type: object } }
 *       400:
 *         description: No branches configured
 *       404:
 *         description: Business not found
 */
const prisma = new PrismaClient();

router.get('/business/:username', publicBusinessLimiter, async (req, res, next) => {
  try {
    const { username } = req.params;
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: {
        business: {
          include: {
            branches: { where: { updatedAt: { not: null } } },
            workers: { where: { updatedAt: { not: null } } },
          },
        },
      },
    });

    if (!user || !user.business) {
      const err = new Error('Negocio no encontrado');
      err.statusCode = 404;
      throw err;
    }

    if (!user.business.branches.length) {
      const err = new Error('No hay sucursales configuradas');
      err.statusCode = 400;
      throw err;
    }

    res.json({
      business: {
        id: user.business.id,
        name: user.business.name,
        logo: user.business.logo,
        timezone: user.business.timezone,
      },
      branches: user.business.branches,
      workers: user.business.workers,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /public/business/{username}/availability:
 *   get:
 *     summary: Obtener disponibilidad de un negocio
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: username
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         required: true
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: workerId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Availability retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 availableSlots: { type: array, items: { type: object } }
 *       400:
 *         description: Invalid date
 *       404:
 *         description: Business not found
 */
router.get('/business/:username/availability', availabilityLimiter, async (req, res, next) => {
  try {
    const { username } = req.params;
    const { date, branchId, workerId } = req.query;

    if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
      const err = new Error('Fecha inválida');
      err.statusCode = 400;
      throw err;
    }

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { business: true },
    });

    if (!user || !user.business) {
      const err = new Error('Negocio no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();

    const slots = await prisma.availableSlots.findMany({
      where: {
        businessId: user.business.id,
        date: { gte: startOfDay, lte: endOfDay },
        branchId: branchId ? parseInt(branchId) : undefined,
        workerId: workerId ? parseInt(workerId) : undefined,
      },
      orderBy: { startTime: 'asc' },
    });

    res.json({ availableSlots: slots });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /public/business/{username}/appointments:
 *   post:
 *     summary: Crear una cita pública
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: username
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               branchId: { type: integer }
 *               workerId: { type: integer }
 *               startTime: { type: string, format: date-time }
 *               endTime: { type: string, format: date-time }
 *               clientName: { type: string, maxLength: 100 }
 *               clientEmail: { type: string, format: email }
 *               clientPhone: { type: string, maxLength: 20 }
 *     responses:
 *       200:
 *         description: Appointment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 appointmentId: { type: integer }
 *       400:
 *         description: Invalid input or slot not available
 *       404:
 *         description: Business not found
 */
router.post('/business/:username/appointments', appointmentLimiter, async (req, res, next) => {
  try {
    const { error, value } = schemas.createAppointment.validate(req.body);
    if (error) {
      const err = new Error(error.details[0].message);
      err.statusCode = 400;
      throw err;
    }

    const { username } = req.params;
    const { branchId, workerId, startTime, endTime, clientName, clientEmail, clientPhone } = value;

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { business: true },
    });

    if (!user || !user.business) {
      const err = new Error('Negocio no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const business = user.business;
    const start = moment(startTime).tz(business.timezone);
    const end = moment(endTime).tz(business.timezone);

    if (start.isSameOrAfter(end)) {
      const err = new Error('startTime debe ser antes que endTime');
      err.statusCode = 400;
      throw err;
    }

    const availableSlot = await prisma.availableSlots.findFirst({
      where: {
        businessId: business.id,
        date: start.startOf('day').toDate(),
        startTime: start.format('HH:mm:ss'),
        endTime: end.format('HH:mm:ss'),
        branchId: branchId || undefined,
        workerId: workerId || undefined,
      },
    });

    if (!availableSlot) {
      const err = new Error('Horario no disponible');
      err.statusCode = 400;
      throw err;
    }

    const overlapping = await prisma.appointment.findFirst({
      where: {
        businessId: business.id,
        branchId: branchId || undefined,
        workerId: workerId || undefined,
        status: { not: 'cancelled' },
        startTime: { lte: end.toDate() },
        endTime: { gte: start.toDate() },
      },
    });

    if (overlapping) {
      const err = new Error('Horario ya reservado');
      err.statusCode = 400;
      throw err;
    }

    const appointment = await prisma.$transaction(async (tx) => {
      const newAppointment = await tx.appointment.create({
        data: {
          businessId: business.id,
          branchId,
          workerId,
          clientName,
          clientEmail,
          clientPhone,
          startTime: start.toDate(),
          endTime: end.toDate(),
          status: 'pending',
        },
      });

      const token = crypto.randomBytes(32).toString('hex');
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
        to: clientEmail,
        subject: 'Confirmación de Cita',
        template: 'confirmation',
        data: {
          businessName: business.name,
          date: start.format('DD-MM-YYYY'),
          time: start.format('HH:mm'),
          appointmentId: newAppointment.id,
          token,
        },
      });

      return newAppointment;
    });

    res.json({ appointmentId: appointment.id });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /public/appointments/{id}:
 *   put:
 *     summary: Reprogramar cita pública
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *               startTime: { type: string, format: date-time }
 *               endTime: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Appointment rescheduled successfully
 *       400:
 *         description: Invalid input or slot not available
 *       404:
 *         description: Appointment or token not found
 */
router.put('/appointments/:id', async (req, res, next) => {
  try {
    const { error, value } = schemas.manageAppointment.validate({
      id: parseInt(req.params.id),
      ...req.body,
    });
    if (error) {
      const err = new Error(error.details[0].message);
      err.statusCode = 400;
      throw err;
    }

    const { id, token, startTime, endTime } = value;
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!appointment) {
      const err = new Error('Cita no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const tempToken = await prisma.temporaryToken.findFirst({
      where: {
        appointmentId: id,
        token,
        clientEmail: appointment.clientEmail,
        expiresAt: { gt: new Date() },
        used: false,
      },
    });

    if (!tempToken) {
      const err = new Error('Token inválido o expirado');
      err.statusCode = 400;
      throw err;
    }

    const start = moment(startTime).tz(appointment.business.timezone);
    const end = moment(endTime).tz(appointment.business.timezone);

    if (start.isSameOrAfter(end)) {
      const err = new Error('startTime debe ser antes que endTime');
      err.statusCode = 400;
      throw err;
    }

    const availableSlot = await prisma.availableSlots.findFirst({
      where: {
        businessId: appointment.businessId,
        date: start.startOf('day').toDate(),
        startTime: start.format('HH:mm:ss'),
        endTime: end.format('HH:mm:ss'),
        branchId: appointment.branchId || undefined,
        workerId: appointment.workerId || undefined,
      },
    });

    if (!availableSlot) {
      const err = new Error('Horario no disponible');
      err.statusCode = 400;
      throw err;
    }

    const overlapping = await prisma.appointment.findFirst({
      where: {
        businessId: appointment.businessId,
        branchId: appointment.branchId || undefined,
        workerId: appointment.workerId || undefined,
        status: { not: 'cancelled' },
        id: { not: id },
        startTime: { lte: end.toDate() },
        endTime: { gte: start.toDate() },
      },
    });

    if (overlapping) {
      const err = new Error('Horario ya reservado');
      err.statusCode = 400;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: {
          startTime: start.toDate(),
          endTime: end.toDate(),
        },
      });

      await tx.temporaryToken.update({
        where: { id: tempToken.id },
        data: { used: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Appointment',
          entityId: id,
        },
      });
    });

    res.json({ message: 'Cita reprogramada exitosamente' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /public/appointments/{id}:
 *   delete:
 *     summary: Cancelar cita pública
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Appointment cancelled successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Appointment or token not found
 */
router.delete('/appointments/:id', async (req, res, next) => {
  try {
    const { error, value } = schemas.manageAppointment.validate({
      id: parseInt(req.params.id),
      token: req.body.token,
    });
    if (error) {
      const err = new Error(error.details[0].message);
      err.statusCode = 400;
      throw err;
    }

    const { id, token } = value;
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!appointment) {
      const err = new Error('Cita no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const tempToken = await prisma.temporaryToken.findFirst({
      where: {
        appointmentId: id,
        token,
        clientEmail: appointment.clientEmail,
        expiresAt: { gt: new Date() },
        used: false,
      },
    });

    if (!tempToken) {
      const err = new Error('Token inválido o expirado');
      err.statusCode = 400;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      await tx.temporaryToken.update({
        where: { id: tempToken.id },
        data: { used: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Appointment',
          entityId: id,
        },
      });

      await sendEmail({
        to: appointment.clientEmail,
        subject: 'Cita Cancelada',
        template: 'cancellation',
        data: {
          businessName: appointment.business.name,
          date: moment(appointment.startTime).format('DD-MM-YYYY'),
          time: moment(appointment.startTime).format('HH:mm'),
        },
      });
    });

    res.json({ message: 'Cita cancelada exitosamente' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;