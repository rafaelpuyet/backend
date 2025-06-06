// server/src/routes/business.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authenticate = require('../middleware/authenticate');
const prisma = new PrismaClient();
const router = express.Router();

// Create or update business details
router.post('/', authenticate, async (req, res) => {
  const { business_name, description, logo_url, address, city, zipcode } = req.body;

  // Input validation
  if (!business_name) {
    return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });
  }

  try {
    // Check if business exists for the user
    const existingBusiness = await prisma.businesses.findUnique({
      where: { username: req.user.username },
    });

    let business;
    if (existingBusiness) {
      // Update existing business
      business = await prisma.businesses.update({
        where: { username: req.user.username },
        data: {
          business_name,
          description: description || null,
          logo_url: logo_url || null,
          address: address || null,
          city: city || null,
          zipcode: zipcode || null,
          updated_at: new Date(),
        },
      });
    } else {
      // Create new business
      business = await prisma.businesses.create({
        data: {
          username: req.user.username,
          business_name,
          description: description || null,
          logo_url: logo_url || null,
          address: address || null,
          city: city || null,
          zipcode: zipcode || null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    res.status(existingBusiness ? 200 : 201).json(business);
  } catch (error) {
    console.error('Error al crear/actualizar negocio:', error);
    res.status(500).json({ error: 'Error al gestionar los datos del negocio' });
  }
});

// Get business details
router.get('/', authenticate, async (req, res) => {
  try {
    const business = await prisma.businesses.findUnique({
      where: { username: req.user.username },
    });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    res.json(business);
  } catch (error) {
    console.error('Error al obtener negocio:', error);
    res.status(500).json({ error: 'Error al obtener datos del negocio' });
  }
});

router.put('/update', authenticate, async (req, res, next) => {
  const { name, logo } = req.body;
  const userId = req.user.userId;

  try {
    // Buscar el negocio asociado al usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { business: true },
    });

    if (!user || !user.business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Actualizar datos del negocio
    await prisma.business.update({
      where: { id: user.businessId },
      data: {
        name: name || user.business.name,
        logo: logo || user.business.logo,
      },
    });

    // Generar nuevo token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ token });
  } catch (error) {
    next(error);
  }
});

module.exports = router;