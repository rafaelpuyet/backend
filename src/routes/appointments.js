const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const schemas = require('../utils/validation');
const authenticate = require('../middleware/authenticate');
const moment = require('moment-timezone');
const jwt = require('jsonwebtoken');

/**
 * @swagger
 * /appointments/{id}:
 *   put:
 *     summary: Actualizar cita
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
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
 *               id: { type: integer }
 *               startTime: { type: string, format: date-time }
 *               endTime: { type: string, format: date-time }
 *               status: { type: string, enum: [pending, confirmed, cancelled] }
 *     responses:
 *       200:
 *         description: Appointment updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       400:
 *         description: Invalid input or status transition
 *       404:
 *         description: Appointment not found
 */
const prisma = new PrismaClient();

router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateAppointment.validate({ id: parseInt(req.params.id), ...req.body });
    if (error) {
      const err = new Error(error.details[0].message);
      err.statusCode = 400;
      throw err;
    }

    const { id, startTime, endTime, status } = value;
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      const err = new Error('Cita no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business || appointment.businessId !== business.id) {
      const err = new Error('No autorizado');
      err.statusCode = 403;
      throw err;
    }

    if (status) {
      const validTransitions = {
        pending: ['confirmed', 'cancelled'],
        confirmed: ['cancelled'],
        cancelled: [],
      };
      if (!validTransitions[appointment.status].includes(status)) {
        const err = new Error('Transición de estado inválida');
        err.statusCode = 400;
        throw err;
      }
    }

    if (startTime && endTime) {
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
          id: { not: id },
          status: { not: 'cancelled' },
          startTime: { lte: end.toDate() },
          endTime: { gte: start.toDate() },
        },
      });
      if (overlapping) {
        const err = new Error('Horario ocupado');
        err.statusCode = 400;
        throw err;
      }
    }

    const data = {};
    if (startTime) data.startTime = new Date(startTime);
    if (endTime) data.endTime = new Date(endTime);
    if (status) data.status = status;

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data,
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Appointment',
          entityId: id,
          userId: req.user.userId,
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

/**
 * @swagger
 * /appointments/audit-logs:
 *   get:
 *     summary: Obtener registros de auditoría
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: entity
 *         schema:
 *           type: string
 *         description: Filtrar por entidad (e.g., Appointment, User)
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: integer
 *         description: Filtrar por ID de entidad
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs: { type: array, items: { type: object } }
 *       403:
 *         description: No autorizado
 */
router.get('/audit-logs', authenticate, async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) {
      const err = new Error('No autorizado');
      err.statusCode = 403;
      throw err;
    }

    const { entity, entityId } = req.query;
    const where = { userId: req.user.userId };
    if (entity) where.entity = entity;
    if (entityId) where.entityId = parseInt(entityId);

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;