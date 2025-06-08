const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const { sendVerificationEmail } = require('../utils/email');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const prisma = new PrismaClient();

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().max(100).when('isBusiness', { is: false, then: Joi.required() }),
  phone: Joi.string().max(20).allow('', null).optional(),
  username: Joi.string().pattern(/^[a-zA-Z0-9-]+$/).min(3).max(50).required(),
  businessName: Joi.string().max(100).allow('', null).optional(),
  logo: Joi.string().max(255).allow('', null).optional(),
  isBusiness: Joi.boolean().default(false)
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const resendSchema = Joi.object({
  email: Joi.string().email().required()
});

// Rate limiters
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const resendLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3 });

router.post('/register', registerLimiter, async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, password, name, phone, username, businessName, logo, isBusiness } = value;

  try {
    // Check for existing email/username
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username: username.toLowerCase() }] }
    });
    if (existingUser) return res.status(400).json({ error: 'Email or username already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const businessNameDefault = isBusiness ? businessName || `Agenda de ${username}` : `Agenda de ${name || username}`;
    const token = uuidv4();
    console.log(`Generated verification token for ${email}: ${token}`);

    // Perform all operations in a transaction
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: isBusiness ? null : name,
          phone: phone || null,
          username: username.toLowerCase(),
          isBusiness
        }
      });

      const business = await tx.business.create({
        data: {
          userId: user.id,
          name: businessNameDefault,
          logo: logo || null,
          timezone: 'America/Santiago'
        }
      });

      if (!isBusiness) {
        await tx.worker.create({
          data: {
            businessId: business.id,
            workerName: name,
            isOwner: true
          }
        });
      } else {
        await tx.branch.create({
          data: {
            businessId: business.id,
            name: 'Sucursal Principal'
          }
        });
      }

      await tx.schedule.create({
        data: {
          businessId: business.id,
          dayOfWeek: 1, // Monday
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDuration: 30
        }
      });

      await tx.verificationToken.deleteMany({ where: { userId: user.id } });
      await tx.verificationToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        }
      });

      await sendVerificationEmail(email, token);
    });

    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.message.includes('Failed to send verification email')) {
      return res.status(503).json({ error: 'Failed to send verification email, please try again later' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    console.log('No token provided in /auth/verify');
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    console.log(`Attempting to verify token: ${token}`);
    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token: String(token) }
    });

    if (!verificationToken) {
      console.log('Token not found in database');
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (verificationToken.expiresAt < new Date()) {
      console.log(`Token expired for userId: ${verificationToken.userId}`);
      await prisma.verificationToken.delete({ where: { token } });
      return res.status(400).json({ error: 'Token has expired, please request a new verification email' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: verificationToken.userId },
        data: { isVerified: true }
      }),
      prisma.verificationToken.delete({ where: { token } })
    ]);

    console.log(`User ${verificationToken.userId} verified successfully`);
    res.json({ message: 'Account verified successfully. Please log in to continue.' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/resend-verification', resendLimiter, async (req, res) => {
  const { error, value } = resendSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email } = value;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isVerified) return res.status(400).json({ error: 'User not found or already verified' });

    await prisma.$transaction(async (tx) => {
      await tx.verificationToken.deleteMany({ where: { userId: user.id } });
      const token = uuidv4();
      console.log(`Generated resend verification token for ${email}: ${token}`);
      await tx.verificationToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }
      });
      await sendVerificationEmail(email, token);
    });

    res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    if (error.message.includes('Failed to send verification email')) {
      return res.status(503).json({ error: 'Failed to send verification email, please try again later' });
    }
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

router.post('/login', async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, password } = value;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    if (!user.isVerified) return res.status(403).json({ error: 'Account not verified' });

    const token = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = uuidv4();
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      }
    });

    res.json({ token, refreshToken });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

  try {
    const tokenRecord = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: tokenRecord.userId } });
    const newToken = jwt.sign({ userId: user.id, isBusiness: user.isBusiness, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const newRefreshToken = uuidv4();

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { token: refreshToken } }),
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      })
    ]);

    res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        business: {
          include: {
            workers: {
              where: { isOwner: true },
              take: 1 // Limit to one owner worker
            }
          }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      username: user.username,
      isBusiness: user.isBusiness,
      business: user.business,
      worker: user.business?.workers[0] || null // Map first owner worker or null
    });
  } catch (error) {
    console.error('Me endpoint error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;