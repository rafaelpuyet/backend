// server/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');
const { isValidEmail, isValidUsername, isValidPhoneNumber, isValidPassword, isValidName, isValidAddress, isValidCityCountry, isValidZipcode } = require('../utils/validation');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  // Check if req.body is defined
  if (!req.body) {
    return res.status(400).json({ error: 'Cuerpo de la solicitud vacío o inválido' });
  }

  const { email, username, password, phone_number, first_name, last_name, address, city, zipcode } = req.body;
  const errors = [];

  // Input validation
  if (!email?.trim()) errors.push('El correo es obligatorio');
  if (!username?.trim()) errors.push('El nombre de usuario es obligatorio');
  if (!password) errors.push('La contraseña es obligatoria');
  if (!phone_number?.trim()) errors.push('El número de teléfono es obligatorio');

  if (email && !isValidEmail(email)) errors.push('Correo electrónico inválido');
  if (username && !isValidUsername(username)) errors.push('Nombre de usuario inválido (3-20 caracteres, solo letras, números y guiones)');
  if (password && !isValidPassword(password)) errors.push('La contraseña debe tener al menos 8 caracteres, incluyendo una letra y un número');
  if (phone_number && !isValidPhoneNumber(phone_number)) errors.push('Número de teléfono inválido (formato: +56912345678)');
  if (first_name && !isValidName(first_name)) errors.push('Nombre inválido (2-50 caracteres, solo letras y espacios)');
  if (last_name && !isValidName(last_name)) errors.push('Apellido inválido (2-50 caracteres, solo letras y espacios)');
  if (address && !isValidAddress(address)) errors.push('Dirección inválida (5-100 caracteres)');
  if (city && !isValidCityCountry(city)) errors.push('Ciudad inválida (2-50 caracteres, solo letras y espacios)');
  if (zipcode && !isValidZipcode(zipcode)) errors.push('Código postal inválido (5-10 caracteres, alfanumérico)');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const normalizedEmail = email.toLowerCase();
  const normalizedUsername = username.toLowerCase();

  try {
    // Check for existing email, username, or phone_number
    const existingUser = await prisma.users.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }, { phone_number }] },
    });
    if (existingUser) {
      if (existingUser.email === normalizedEmail) errors.push('El correo ya está registrado');
      if (existingUser.username === normalizedUsername) errors.push('El nombre de usuario ya está en uso');
      if (existingUser.phone_number === phone_number) errors.push('El número de teléfono ya está registrado');
      return res.status(400).json({ errors });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.users.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
        phone_number,
        plan: 'free',
        first_name: first_name || '',
        last_name: last_name || '',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
      },
    });

    // Auto-create business
    await prisma.businesses.create({
      data: {
        username: normalizedUsername,
        business_name: username.charAt(0).toUpperCase() + username.slice(1),
        address: address || null,
        city: city || null,
        zipcode: zipcode || null,
        description: null,
        logo_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Create JWT
    const token = jwt.sign(
      { id: user.id, email: normalizedEmail },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: normalizedEmail,
        username: normalizedUsername,
        phone_number,
        first_name: user.first_name,
        last_name: user.last_name,
        plan: user.plan,
      },
    });
  } catch (error) {
    console.error('Error en registro:', error.message, error.stack);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// Login
router.post('/', async (req, res) => {
  // Check if req.body is defined
  if (!req.body) {
    return res.status(400).json({ error: 'Cuerpo de la solicitud vacío o inválido' });
  }

  const { identifier, password } = req.body;

  // Input validation
  if (!identifier?.trim() || !password) {
    return res.status(400).json({ error: 'Identificador y contraseña son obligatorios' });
  }

  try {
    // Find user by email or username
    const user = await prisma.users.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }] },
    });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
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
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        phone_number: user.phone_number,
        first_name: user.first_name,
        last_name: user.last_name,
        plan: user.plan,
      },
    });
  } catch (error) {
    console.error('Error en login:', error.message, error.stack);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Get user data
router.get('/user', authenticateJWT, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        phone_number: true,
        first_name: true,
        last_name: true,
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
    console.error('Error al obtener usuario:', error.message, error.stack);
    res.status(500).json({ error: 'Error al obtener datos del usuario' });
  }
});

module.exports = router;