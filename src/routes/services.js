// server/src/routes/services.js
const express = require('express');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');
const { isValidName } = require('../utils/validation');

const router = express.Router();

// Create a service
router.post('/', authenticateJWT, async (req, res) => {
  const { name, description, price, duration } = req.body;
  const errors = [];

  // Validation
  if (!name?.trim()) errors.push('El nombre del servicio es obligatorio');
  if (name && !isValidName(name)) errors.push('Nombre del servicio inválido (2-50 caracteres, solo letras y espacios)');
  if (description && description.length > 500) errors.push('Descripción demasiado larga (máximo 500 caracteres)');
  if (price == null || price < 0) errors.push('Precio inválido (debe ser mayor o igual a 0)');
  if (!duration || ![15, 30, 45, 60, 90, 120].includes(duration)) errors.push('Duración inválida (15, 30, 45, 60, 90 o 120 minutos)');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const business = await prisma.businesses.findUnique({
      where: { username: req.user.username },
    });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const service = await prisma.services.create({
      data: {
        business_id: business.id,
        name,
        description: description || null,
        price,
        duration,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    res.status(201).json(service);
  } catch (error) {
    console.error('Error al crear servicio:', error.message, error.stack);
    res.status(500).json({ error: 'Error al crear el servicio' });
  }
});

// Get services for a business
router.get('/', async (req, res) => {
  const { business_username } = req.query;

  if (!business_username) {
    return res.status(400).json({ error: 'Nombre de usuario del negocio requerido' });
  }

  try {
    const business = await prisma.businesses.findUnique({
      where: { username: business_username },
    });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const services = await prisma.services.findMany({
      where: { business_id: business.id },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        duration: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.json(services);
  } catch (error) {
    console.error('Error al obtener servicios:', error.message, error.stack);
    res.status(500).json({ error: 'Error al obtener los servicios' });
  }
});

module.exports = router;