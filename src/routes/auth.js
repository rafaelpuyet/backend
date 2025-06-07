const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { sendEmail } = require('../utils/email');
const schemas = require('../utils/validation');
const { resendVerificationLimiter } = require('../middleware/rateLimit');

const prisma = new PrismaClient();

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = schemas.register.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { email, password, name, phone, username, businessName, logo, isBusiness } = value;
    const normalizedUsername = username.toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username: normalizedUsername }] }
    });
    if (existingUser) throw new Error('Email or username already exists', { statusCode: 400 });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone,
          username: normalizedUsername,
          isBusiness,
        },
      });

      const business = await tx.business.create({
        data: {
          userId: newUser.id,
          name: businessName || `Agenda de ${name || normalizedUsername}`,
          logo,
          timezone: 'UTC',
        },
      });

      if (!isBusiness) {
        await tx.worker.create({
          data: {
            businessId: business.id,
            workerName: name,
            isOwner: true,
          },
        });
      } else {
        await tx.branch.create({
          data: {
            businessId: business.id,
            name: 'Sucursal Principal',
          },
        });
      }

      await tx.schedule.create({
        data: {
          businessId: business.id,
          dayOfWeek: [1, 2, 3, 4, 5], // Lunes-Viernes
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDuration: 30,
        },
      });

      await tx.verificationToken.deleteMany({ where: { userId: newUser.id } });
      const token = require('crypto').randomBytes(32).toString('hex');
      await tx.verificationToken.create({
        data: {
          userId: newUser.id,
          token,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      await sendEmail({
        to: email,
        subject: 'Verifica tu cuenta',
        template: 'verification',
        data: { token },
      });

      return newUser;
    });

    const token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: normalizedUsername },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// GET /auth/verify
router.get('/verify', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) throw new Error('Token required', { statusCode: 400 });

    const verificationToken = await prisma.verificationToken.findUnique({ where: { token } });
    if (!verificationToken) throw new Error('Invalid token', { statusCode: 400 });
    if (verificationToken.expiresAt < new Date()) throw new Error('Token expired', { statusCode: 400 });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: { isVerified: true },
      });
      await tx.verificationToken.delete({ where: { token } });
    });

    res.json({ message: 'Account verified successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /auth/resend-verification
router.post('/resend-verification', resendVerificationLimiter, async (req, res, next) => {
  try {
    const { error, value } = schemas.resendVerification.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { email } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('Email not registered', { statusCode: 400 });
    if (user.isVerified) throw new Error('Account already verified', { statusCode: 400 });

    await prisma.$transaction(async (tx) => {
      await tx.verificationToken.deleteMany({ where: { userId: user.id } });
      const token = require('crypto').randomBytes(32).toString('hex');
      await tx.verificationToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      await sendEmail({
        to: email,
        subject: 'Verifica tu cuenta',
        template: 'verification',
        data: { token },
      });
    });

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = schemas.login.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { email, password } = value;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('Invalid credentials', { statusCode: 400 });
    if (!user.isVerified) throw new Error('Account not verified', { statusCode: 403 });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new Error('Invalid credentials', { statusCode: 400 });

    const token = jwt.sign(
      { userId: user.id, isBusiness: user.isBusiness, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const refreshToken = require('crypto').randomBytes(32).toString('hex');
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({ token, refreshToken });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { error, value } = schemas.refreshToken.validate(req.body);
    if (error) throw Object.assign(error, { statusCode: 400 });

    const { token: refreshToken } = value;
    const storedToken = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!storedToken) throw new Error('Invalid refresh token', { statusCode: 401 });
    if (storedToken.expiresAt < new Date()) throw new Error('Refresh token expired', { statusCode: 401 });

    const user = await prisma.user.findUnique({ where: { id: storedToken.userId } });
    if (!user) throw new Error('User not found', { statusCode: 401 });

    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.delete({ where: { token: refreshToken } });
      const newRefreshToken = require('crypto').randomBytes(32).toString('hex');
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const token = jwt.sign(
        { userId: user.id, isBusiness: user.isBusiness, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      res.json({ token, refreshToken: newRefreshToken });
    });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
router.get('/me', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated', { statusCode: 401 });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        business: true,
        workers: { where: { isOwner: true }, select: { id: true, workerName: true, isOwner: true } },
      },
    });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      username: user.username,
      isBusiness: user.isBusiness,
      business: user.business,
      worker: user.workers[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;