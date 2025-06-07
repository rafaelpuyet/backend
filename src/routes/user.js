const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const schemas = require('../utils/validation');
const authenticate = require('../middleware/authenticate');
const jwt = require('jsonwebtoken');

/**
 * @swagger
 * /user/update:
 *   put:
 *     summary: Actualizar datos del usuario
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               phone: { type: string, maxLength: 20 }
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User or business not found
 */
const prisma = new PrismaClient();

router.put('/update', authenticate, async (req, res, next) => {
  try {
    const { error, value } = schemas.updateUser.validate(req.body);
    if (error) {
      const err = new Error(error.details[0].message);
      err.statusCode = 400;
      throw err;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      const err = new Error('Usuario no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const business = await prisma.business.findUnique({ where: { userId: user.id } });
    if (!business) {
      const err = new Error('Negocio no encontrado');
      err.statusCode = 404;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: value,
      });

      if (value.name && !user.isBusiness) {
        await tx.worker.updateMany({
          where: { businessId: business.id, isOwner: true },
          data: { workerName: value.name },
        });
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