const express = require('express');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const authenticate = require('../middleware/authenticate');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const prisma = new PrismaClient();

const businessUpdateSchema = Joi.object({
  name: Joi.string().max(100).allow('', null).optional(),
  logo: Joi.string().max(255).allow('', null).optional(), // Explicitly allow empty string and null
  timezone: Joi.string().max(50).optional()
});

const userUpdateSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  phone: Joi.string().max(20).allow('', null).optional()
});

const branchSchema = Joi.object({
  name: Joi.string().max(100).required(),
  address: Joi.string().max(255).allow('', null).optional()
});

const workerSchema = Joi.object({
  branchId: Joi.number().integer().optional(),
  workerName: Joi.string().max(100).required(),
  isOwner: Joi.boolean().default(false)
});

const scheduleSchema = Joi.object({
  branchId: Joi.number().integer().optional(),
  workerId: Joi.number().integer().optional(),
  dayOfWeek: Joi.number().integer().min(0).max(6).required(),
  startTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
  endTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).required(),
  slotDuration: Joi.number().integer().min(5).max(120).multiple(5).required()
});

const exceptionSchema = Joi.object({
  branchId: Joi.number().integer().optional(),
  workerId: Joi.number().integer().optional(),
  date: Joi.date().iso().required(),
  isClosed: Joi.boolean().required(),
  startTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  endTime: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional()
});

const appointmentUpdateSchema = Joi.object({
  startTime: Joi.date().iso().optional(),
  endTime: Joi.date().iso().optional(),
  status: Joi.string().valid('pending', 'confirmed', 'cancelled').optional()
});

const auditLogQuerySchema = Joi.object({
  entity: Joi.string().max(50).optional(),
  entityId: Joi.number().integer().optional(),
  action: Joi.string().valid('create', 'update', 'delete').optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional()
});

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 200 });

router.use(authenticate);
router.use(limiter);

router.put('/user/update', async (req, res) => {
  const { error, value } = userUpdateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { worker: { where: { isOwner: true } } }
    });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: value
      });
      if (user.worker[0] && value.name) {
        await tx.worker.update({
          where: { id: user.worker[0].id },
          data: { workerName: value.name }
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'User',
          entityId: user.id,
          userId: user.id
        }
      });
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'User update failed' });
  }
});

router.put('/business/update', async (req, res) => {
  const { error, value } = businessUpdateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (!user.business) return res.status(404).json({ error: 'Business not found' });

    await prisma.$transaction([
      prisma.business.update({
        where: { id: user.business.id },
        data: {
          name: value.name || undefined,
          logo: value.logo || null, // Ensure logo is null if not provided
          timezone: value.timezone || undefined
        }
      }),
      prisma.auditLog.create({
        data: {
          action: 'update',
          entity: 'Business',
          entityId: user.business.id,
          userId: user.id
        }
      })
    ]);

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Business update failed' });
  }
});

router.post('/branches', async (req, res) => {
  const { error, value } = branchSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (!user.isBusiness) return res.status(403).json({ error: 'Not a business account' });

    const branch = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          businessId: user.business.id,
          ...value
        }
      });
      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Branch',
          entityId: branch.id,
          userId: user.id
        }
      });
      return branch;
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Branch creation failed' });
  }
});

router.put('/branches/:id', async (req, res) => {
  const { error, value } = branchSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (!user.isBusiness) return res.status(403).json({ error: 'Not a business account' });

    const branch = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.update({
        where: { id: parseInt(req.params.id), businessId: user.business.id },
        data: value
      });
      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Branch',
          entityId: branch.id,
          userId: user.id
        }
      });
      return branch;
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(404).json({ error: 'Branch not found or update failed' });
  }
});

router.delete('/branches/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (!user.isBusiness) return res.status(403).json({ error: 'Not a business account' });

    await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.delete({
        where: { id: parseInt(req.params.id), businessId: user.business.id }
      });
      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Branch',
          entityId: branch.id,
          userId: user.id
        }
      });
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(404).json({ error: 'Branch not found or deletion failed' });
  }
});

router.post('/workers', async (req, res) => {
  const { error, value } = workerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (!user.isBusiness && value.isOwner) return res.status(403).json({ error: 'Cannot set isOwner for non-business accounts' });

    const worker = await prisma.$transaction(async (tx) => {
      const worker = await tx.worker.create({
        data: {
          businessId: user.business.id,
          ...value
        }
      });
      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Worker',
          entityId: worker.id,
          userId: user.id
        }
      });
      return worker;
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Worker creation failed' });
  }
});

router.put('/workers/:id', async (req, res) => {
  const { error, value } = workerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    const worker = await prisma.worker.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!worker || worker.businessId !== user.business.id) return res.status(404).json({ error: 'Worker not found' });
    if (worker.isOwner && value.isOwner !== undefined) return res.status(403).json({ error: 'Cannot modify isOwner for owner worker' });

    await prisma.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id: parseInt(req.params.id) },
        data: value
      });
      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Worker',
          entityId: parseInt(req.params.id),
          userId: user.id
        }
      });
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Worker update failed' });
  }
});

router.delete('/workers/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    const worker = await prisma.worker.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!worker || worker.businessId !== user.business.id) return res.status(404).json({ error: 'Worker not found' });
    if (worker.isOwner) return res.status(403).json({ error: 'Cannot delete owner worker' });

    await prisma.$transaction(async (tx) => {
      await tx.worker.delete({ where: { id: parseInt(req.params.id) } });
      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Worker',
          entityId: parseInt(req.params.id),
          userId: user.id
        }
      });
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Worker deletion failed' });
  }
});

router.post('/schedules', async (req, res) => {
  const { error, value } = scheduleSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { business: true } });
    if (value.startTime >= value.endTime) return res.status(400).json({ error: 'startTime must be before endTime' });

    // Check for overlapping schedules
    const overlapping = await prisma.schedule.findFirst({
      where: {
        businessId: user.business.id,
        workerId: value.workerId,
        dayOfWeek: value.dayOfWeek,
        OR: [
          { startTime: { lte: value.endTime }, endTime: { gte: value.startTime } }
        ]
      }
    });
    if (overlapping) return res.status(400).json({ error: 'Schedule overlaps with existing schedule' });

    const schedule = await prisma.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: {
          businessId: user.business.id,
          ...value
        }
      });
      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Schedule',
          entityId: schedule.id,
          userId: user.id
        }
      });
      return schedule;
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Schedule creation failed' });
  }
});

// Additional endpoints for schedules, exceptions, appointments, and audit logs follow similar patterns
router.get('/audit-logs', async (req, res) => {
  const { error, value } = auditLogQuerySchema.validate(req.query);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        userId: req.user.userId,
        entity: value.entity,
        entityId: value.entityId,
        action: value.action,
        createdAt: {
          gte: value.startDate ? new Date(value.startDate) : undefined,
          lte: value.endDate ? new Date(value.endDate) : undefined
        }
      },
      take: 100
    });

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;