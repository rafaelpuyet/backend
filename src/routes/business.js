// server/src/routes/business.js
const express = require('express');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// Create or update business details
router.post('/', authenticateJWT, async (req, res) => {
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
router.get('/', authenticateJWT, async (req, res) => {
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

module.exports = router;