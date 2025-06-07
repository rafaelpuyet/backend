const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const schemas = require('../utils/validation');
const authenticate = require('../middleware/authenticate');

const prisma = new PrismaClient();

// PUT /business/update
router.put('/update', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateBusiness.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: business.id },
        data: value,
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Business',
          entityId: business.id,
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

// POST /branches
router.post('/branches', authenticate, async (req, res, next) => {
  try {
    if (!req.user.isBusiness) throw new Error('Only businesses can create branches', { statusCode: 403 });

    const { error, value } = schemas.createBranch.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    const branch = await prisma.$transaction(async (tx) => {
      const newBranch = await tx.branch.create({
        data: {
          businessId: business.id,
          ...value,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Branch',
          entityId: newBranch.id,
          userId: req.user.userId,
        },
      });

      return newBranch;
    });

    res.json({ branch });
  } catch (err) {
    next(err);
  }
});

// PUT /branches/:id
router.put('/branches/:id', authenticate, async (req, res, next) => {
  try {
    if (!req.user.isBusiness) throw new Error('Only businesses can update branches', { statusCode: 403 });

    const { error, value } = schemas.updateBranch.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const branchId = parseInt(req.params.id);
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new Error('Branch not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id: branchId },
        data: value,
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Branch',
          entityId: branchId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Branch updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /branches/:id
router.delete('/branches/:id', authenticate, async (req, res, next) => {
  try {
    if (!req.user.isBusiness) throw new Error('Only businesses can delete branches', { statusCode: 403 });

    const branchId = parseInt(req.params.id);
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new Error('Branch not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.branch.delete({ where: { id: branchId } });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Branch',
          entityId: branchId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Branch deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /workers
router.post('/workers', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.createWorker.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    const worker = await prisma.$transaction(async (tx) => {
      const newWorker = await tx.worker.create({
        data: {
          businessId: business.id,
          ...value,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Worker',
          entityId: newWorker.id,
          userId: req.user.userId,
        },
      });

      return newWorker;
    });

    res.json({ worker });
  } catch (err) {
    next(err);
  }
});

// PUT /workers/:id
router.put('/workers/:id', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateWorker.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const workerId = parseInt(req.params.id);
    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new Error('Worker not found', { statusCode: 404 });
    if (worker.isOwner) throw new Error('Cannot modify owner worker', { statusCode: 403 });

    await prisma.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id: workerId },
        data: value,
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Worker',
          entityId: workerId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Worker updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /workers/:id
router.delete('/workers/:id', authenticate, async (req, res, next) => {
  try {
    const workerId = parseInt(req.params.id);
    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new Error('Worker not found', { statusCode: 404 });
    if (worker.isOwner) throw new Error('Cannot delete owner worker', { statusCode: 403 });

    await prisma.$transaction(async (tx) => {
      await tx.worker.delete({ where: { id: workerId } });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Worker',
          entityId: workerId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Worker deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /schedules
router.post('/schedules', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.createSchedule.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { branchId, workerId, dayOfWeek, startTime, endTime, slotDuration } = value;
    if (startTime >= endTime) throw new Error('startTime must be before endTime', { statusCode: 400 });

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    const overlapping = await prisma.schedule.findFirst({
      where: {
        businessId: business.id,
        workerId,
        dayOfWeek,
        OR: [
          { startTime: { lte: endTime }, endTime: { gte: startTime } },
          { startTime: { gte: startTime }, endTime: { lte: endTime } },
        ],
      },
    });
    if (overlapping) throw new Error('Overlapping schedule exists', { statusCode: 400 });

    const schedule = await prisma.$transaction(async (tx) => {
      const newSchedule = await tx.schedule.create({
        data: {
          businessId: business.id,
          branchId,
          workerId,
          dayOfWeek,
          startTime,
          endTime,
          slotDuration,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Schedule',
          entityId: newSchedule.id,
          userId: req.user.userId,
        },
      });

      return newSchedule;
    });

    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

// PUT /schedules/:id
router.put('/schedules/:id', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.createSchedule.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const scheduleId = parseInt(req.params.id);
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('Schedule not found', { statusCode: 404, });

    const { branchId, workerId, dayOfWeek, startTime, endTime, slotDuration } = value;
    if (startTime >= endTime) throw new Error('startTime must be before endTime', { statusCode: 400 });

    const overlapping = await prisma.schedule.findFirst({
      where: {
        businessId: schedule.businessId,
        workerId,
        dayOfWeek,
        id: { not: scheduleId },
        OR: [
          { startTime: { lte: endTime }, endTime: { gte: startTime } },
          { startTime: { gte: startTime }, endTime: { lte: endTime } },
        ],
      },
    });
    if (overlapping) throw new Error('Overlapping schedule exists', { statusCode: 400 });

    await prisma.$transaction(async (tx) => {
      await tx.schedule.update({
        where: { id: scheduleId },
        data: value,
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Schedule',
          entityId: scheduleId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Schedule updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /schedules/:id
router.delete('/schedules/:id', authenticate, async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id);
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('Schedule not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.schedule.delete({ where: { id: scheduleId } });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Schedule',
          entityId: scheduleId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Schedule deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /exceptions
router.post('/exceptions', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.createException.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { branchId, workerId, dateTime, isClosed, startTime, endTime } = value;
    if (!isClosed && startTime && endTime && startTime >= endTime) {
      throw new Error('startTime must be before endTime', { statusCode: 400 });
    }

    const business = await prisma.business.findUnique({ where: { userId: req.user.userId } });
    if (!business) throw new Error('Business not found', { statusCode: 404 });

    const exception = await prisma.$transaction(async (tx) => {
      const newException = await tx.exception.create({
        data: {
          businessId: business.id,
          branchId,
          workerId,
          dateTime,
          isClosed,
          startTime: isClosed ? startTime : undefined,
          endTime: isClosed ? endTime: undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'create',
          entity: 'Exception',
          entityId: newException.id,
          userId: req.user.userId,
        },
      });

      return newException;
    });

    res.json({ exception });
  } catch (err) {
    next(err);
  }
});

// PUT /exceptions/:id
router.put('/exceptions/:id', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.createException.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const exceptionId = parseInt(req.params.id);
    const exception = await prisma.exception.findUnique({ where: { id: exceptionId } });
    if (!exception) throw new Error('Exception not found', { statusCode: 404 });

    const { isClosed, startTime, endTime } = value;
    if (!isClosed && startTime && endTime && startTime >= endTime) {
      throw new Error('startTime must be before endTime', { statusCode: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.exception.update({
        where: { id: exceptionId },
        data: {
          ...value,
          startTime: isClosed ? startTime : undefined,
          endTime: isClosed ? endTime : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'Exception',
          entityId: exceptionId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Exception updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE /exceptions/:id
router.delete('/exceptions/:id', authenticate, async (req, res, next) => {
  try {
    const exceptionId = parseInt(req.params.id);
    const exception = await prisma.exception.findUnique({ where: { id: exceptionId } });
    if (!exception) throw new Error('Exception not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.exception.delete({ where: { id: exceptionId } });

      await tx.auditLog.create({
        data: {
          action: 'delete',
          entity: 'Exception',
          entityId: exceptionId,
          userId: req.user.userId,
        },
      });
    });

    res.json({ message: 'Exception deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;