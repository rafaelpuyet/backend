const express = require('express');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { userUpdateSchema } = require('../utils/validation');
const authenticate = require('../middleware/authenticate');

const prisma = new PrismaClient();
const router = express.Router();

router.put('/update', authenticate, async (req, res, next) => {
  try {
    const { error } = userUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { name, phone } = req.body;
    const userId = req.user.userId;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name, phone }
    });

    // Sincronizar workerName si esOwner: true
    if (name) {
      const business = await prisma.business.findFirst({ where: { userId } });
      if (business) {
        await prisma.worker.updateMany({
          where: { businessId: business.id, isOwner: true },
          data: { workerName: name }
        });
      }
    }

    await prisma.auditLog.create({
      data: { action: 'update', entity: 'User', entityId: userId, userId }
    });

    const token = jwt.sign({ userId, isBusiness: updatedUser.isBusiness, username: updatedUser.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;