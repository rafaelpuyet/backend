// server/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');
const { isValidEmail, isValidUsername, isValidPhoneNumber } = require('../utils/validation');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { email, username, password, phone_number } = req.body;

  // Input validation
  if (!email || !username || !password || !phone_number) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Correo electrónico inválido' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Nombre de usuario inválido (3-20 caracteres, solo letras, números y guiones)' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (!isValidPhoneNumber(phone_number)) {
    return res.status(400).json({ error: 'Número de teléfono inválido (formato: +56912345678)' });
  }

  try {
    // Check if email or username exists
    const existingUser = await prisma.users.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existingUser) {
      return res.status(400).json({
        error: existingUser.email === email ? 'El correo ya está registrado' : 'El nombre de usuario ya está en uso',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.users.create({
      data: {
        email,
        username,
        password: hashedPassword,
        phone_number,
        plan: 'free',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
      },
    });

    // Create JWT
    const token = jwt.sign({ user_id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.status(201).json({
      token,
      user: { id: user.id, email, username, phone_number, plan: user.plan },
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  // Input validation
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identificador y contraseña son obligatorios' });
  }

  try {
    // Find user by email or username
    const user = await prisma.users.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Credenciales incorrectas o cuenta inactiva' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Update last_login
    await prisma.users.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    // Create JWT
    const token = jwt.sign({ user_id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        phone_number: user.phone_number,
        plan: user.plan,
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Get user data
router.get('/user', authenticateJWT, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user.user_id },
      select: {
        id: true,
        email: true,
        username: true,
        phone_number: true,
        plan: true,
        created_at: true,
        updated_at: true,
        is_active: true,
        last_login: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ error: 'Error al obtener datos del usuario' });
  }
});

module.exports = router;