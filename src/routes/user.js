const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const schemas = require('../utils/validation');
const authenticate = require('../middleware/authenticate');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

// PUT /user/update
router.put('/update', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateUser.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) throw new Error('User not found', { statusCode: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: value,
      });

      if (value.name) {
        const worker = await tx.worker.findFirst({
          where: { business: { userId: user.id }, isOwner: true },
        });
        if (worker) {
          await tx.worker.update({
            where: { id: worker.id },
            data: { workerName: value.name },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'User',
          entityId: user.id,
          userId: user.id,
        },
      });
    });

    const token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;