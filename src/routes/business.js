const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { scheduleSchema } = require('../utils/validation');
const authenticate = require('../middleware/authenticate');

const prisma = new PrismaClient();
const router = express.Router();

router.put('/update', authenticate, async (req, res, next) => {
  try {
    const { error } = Joi.object({
      name: Joi.string().max(100).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).optional(),
      logo: Joi.string().max(255).optional(),
      timezone: Joi.string().max(50).optional()
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { name, logo, timezone } = req.body;
    const userId = req.user.userId;

    const business = await prisma.business.update({
      where: { userId },
      data: { name, logo, timezone }
    });

    await prisma.auditLog.create({
      data: { action: 'update', entity: 'Business', entityId: business.id, userId }
    });

    res.json({ token: req.headers.authorization.split(' ')[1] });
  } catch (err) {
    next(err);
  }
});

router.post('/branches', authenticate, async (req, res, next) => {
  try {
    if (!req.user.isBusiness) return res.status(403).json({ error: 'Not a business account' });

    const { error } = Joi.object({
      name: Joi.string().max(100).required(),
      address: Joi.string().max(255).optional()
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { name, address } = req.body;
    const userId = req.user.userId;
    const business = await prisma.business.findFirst({ where: { userId } });

    const branch = await prisma.branch.create({
      data: {
        businessId: business.id,
        name,
        address
      }
    });

    await prisma.auditLog.create({
      data: { action: 'create', entity: 'Branch', entityId: branch.id, userId }
    });

    res.json({ token: req.headers.authorization.split(' ')[1] });
  } catch (err) {
    next(err);
  }
});

router.post('/workers', authenticate, async (req, res, next) => {
  try {
    const { error } = Joi.object({
      branchId: Joi.number().optional(),
      name: Joi.string().max(255).pattern(/^[a-zA-ZÀ-ÿ\s-]+$/).required()
    }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { branchId, name } = req.body;
    const userId = req.user.userId;
    const business = await prisma.business.findFirst({ where: { userId } });

    if (branchId && !req.user.isBusiness) return res.status(403).json({ error: 'Not a business account' });
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId, businessId: business.id } });
      if (!branch) return res.status(404).json({ error: 'Branch not found' });
    }

    const worker = await prisma.worker.create({
      data: {
        businessId: business.id,
        branchId,
        workerName: name
      }
    });

    await prisma.auditLog.create({
      data: { action: 'create', entity: 'Worker', entityId: worker.id, userId }
    });

    res.json({ token: req.headers.authorization.split(' ')[1] });
  } catch (err) {
    next(err);
  }
});

router.delete('/workers/:id', authenticate, async(req, res, next) => {
  try{
    const workerId = parseInt(req.params.id);
    const userId = req.user.userId;
    const worker = await prisma.worker.findUnique({
      where: { id: workerId }
    });

    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    if (worker.isOwner) return res.status(403).json({ error: 'Cannot delete owner worker' });

    const business = await prisma.business.findFirst({ where: { userId } });
    if (worker.businessId !== business.id) return res.status(403).json({ error: 'Unauthorized' });

    await prisma.worker.delete({ where: { id: workerId } });

    await prisma.auditLog.create({
      data: { action: 'delete', entity: 'Worker', entityId: workerId, userId }
    });

    res.json({ message: 'Worker deleted', token: req.headers.authorization.split(' ')[1] });
  }
  catch (err) {
    next(err);
  }
});

router.post('/schedules', authenticate, async (req, res, next) => {
  try {
    const { error } = scheduleSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { branchId, workerId, dayOfWeek, startTime, endTime, slotDuration } = req.body;
    const userId = req.user.userId;
    const business = await prisma.business.findFirst({ where: { userId } });

    if (branchId && !req.user.isBusiness) return res.status(403).json({ error: 'Not a business account' });
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId, businessId: business.id } });
      if (!branch) return res.status(404).json({ error: 'Branch not found' });
    }
    if (workerId) {
      const worker = await prisma.worker.findUnique({ where: { id: workerId, businessId: business.id } });
      if (!worker) return res.status(404).json({ error: 'Worker not found' });
    }

    const conflictingSchedule = await prisma.schedule.findFirst({
      where: {
        businessId: business.id,
        workerId,
        dayOfWeek,
        OR: [
          { startTime: { lte: endTime }, endTime: { gte: startTime } },
          { startTime: { gte: startTime }, endTime: { lte: endTime } }
        ]
      }
    });
    if (conflictSchedule) return res.status(400).json({ error: 'Overlapping schedule exists' });

    const schedule = await prisma.schedule.create({
      data: {
        businessId: business.id,
        branchId,
        workerId,
        dayOfWeek,
        startTime,
        endTime,
        slotDuration
      }
    });

    await prisma.auditLog.create({
      data: { action: 'create', entity: 'Schedule', entityId: schedule.id, userId }
    });

    res.json({ token: req.headers.authorization.split(' ')[1] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;