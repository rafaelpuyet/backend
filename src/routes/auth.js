const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { registerSchema, loginSchema } = require('../utils/validation');
const { sendEmail } = require('../utils/email');
const { resendLimiter } = require('../middleware/rateLimit');

const prisma = new PrismaClient();
const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { error } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { email, password, name, phone, username, businessName, logo, isBusiness } = req.body;
    const normalizedUsername = username.toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username: normalizedUsername }] }
    });
    if (existingUser) return res.status(400).json({ error: 'Email or username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone,
        username: normalizedUsername,
        isBusiness
      }
    });

    const business = await prisma.business.create({
      data: {
        userId: user.id,
        name: businessName || `Agenda de ${name || normalizedUsername}`,
        logo
      }
    });

    if (!isBusiness) {
      await prisma.worker.create({
        data: {
          businessId: business.id,
          workerName: name,
          isOwner: true
        }
      });
    } else {
      const branch = await prisma.branch.create({
        data: {
          businessId: business.id,
          name: 'Sucursal Principal'
        }
      });

      await prisma.schedule.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          dayOfWeek: 1, // Lunes
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDuration: 30
        }
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
    await prisma.verificationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutos
      }
    });

    await sendEmail(email, 'Verify your account', `${process.env.FRONTEND_URL}/verify?token=${token}`);

    const jwtToken = jwt.sign({ userId: user.id, isBusiness, username: normalizedUsername }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token: jwtToken });
  } catch (err) {
    next(err);
  }
});

router.get('/verify', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const verificationToken = await prisma.verificationToken.findUnique({ where: { token } });
    if (!verificationToken) return res.status(400).json({ error: 'Invalid token' });
    if (verificationToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Token expired. Please request a new one.' });
    }

    await prisma.user.update({
      where: { id: verificationToken.userId },
      data: { isVerified: true }
    });

    await prisma.verificationToken.delete({ where: { token } });
    res.json({ message: 'Account verified' });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', resendLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await prisma.user.findUnique({ where: { email, isVerified: false } });
    if (!user) return res.status(400).json({ error: 'User not found or already verified' });

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
    await prisma.verificationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    await sendEmail(email, 'Verify your account', `${process.env.FRONTEND_URL}/verify?token=${token}`);
    res.json({ message: 'Verification email resent' });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!user.isVerified) return res.status(403).json({ error: 'Account not verified' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const refreshToken = crypto.randomBytes(32).toString('hex');
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 días
      }
    });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, refreshToken });
  } catch (err) {
    next(err);
  }
});

module.exports = router;