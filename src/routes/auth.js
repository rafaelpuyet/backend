const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const authenticate = require('../middleware/authenticate');
const prisma = new PrismaClient();
const router = express.Router();

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Registro de usuario
router.post('/register', async (req, res, next) => {
  const { email, password, name, phone, businessName, logo } = req.body;

  try {
    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generar token de verificación
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    // Crear usuario, negocio y token en una transacción
    const user = await prisma.$transaction(async (prisma) => {
      const newBusiness = await prisma.business.create({
        data: {
          name: businessName || `Negocio de ${name || 'Usuario'}`,
          logo: logo || null,
        },
      });

      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone,
          businessId: newBusiness.id,
        },
      });

      await prisma.verificationToken.create({
        data: {
          token: verificationToken,
          userId: newUser.id,
          expiresAt,
        },
      });

      return newUser;
    });

    // Enviar correo de verificación
    const verificationUrl = `${process.env.FRONTEND_URL}/verify?token=${verificationToken}`;
    await transporter.sendMail({
      from: `"Agenda App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Activa tu cuenta',
      html: `
        <h1>Bienvenido a Agenda App</h1>
        <p>Por favor, haz clic en el siguiente enlace para activar tu cuenta:</p>
        <a href="${verificationUrl}">Activar cuenta</a>
        <p>Este enlace expirará en 30 minutos.</p>
      `,
    });

    // Generar token JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ token });
  } catch (error) {
    next(error);
  }
});

// Verificación de cuenta
router.get('/verify', async (req, res, next) => {
  const { token } = req.query;

  try {
    // Buscar token de verificación
    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      return res.status(400).json({ error: 'Token inválido' });
    }

    if (new Date() > verificationToken.expiresAt) {
      // Eliminar usuario y negocio si el token ha expirado
      await prisma.$transaction([
        prisma.business.deleteMany({ where: { id: verificationToken.user.businessId } }),
        prisma.user.delete({ where: { id: verificationToken.userId } }),
      ]);
      return res.status(400).json({ error: 'El token ha expirado' });
    }

    // Activar la cuenta
    await prisma.user.update({
      where: { id: verificationToken.userId },
      data: { isVerified: true },
    });

    // Eliminar el token de verificación
    await prisma.verificationToken.delete({ where: { token } });

    res.status(200).json({ message: 'Cuenta verificada exitosamente' });
  } catch (error) {
    next(error);
  }
});

// Login de usuario
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;

  try {
    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    // Buscar usuario
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    // Verificar si la cuenta está verificada
    if (!user.isVerified) {
      return res.status(403).json({ error: 'Cuenta no verificada. Por favor, verifica tu correo.' });
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    // Generar token JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ token });
  } catch (error) {
    next(error);
  }
});

// Obtener datos del usuario autenticado
router.get('/me', authenticate, async (req, res, next) => {
  const userId = req.user.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { business: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      business: {
        name: user.business?.name || null,
        logo: user.business?.logo || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;