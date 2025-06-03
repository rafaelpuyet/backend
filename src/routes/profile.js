// server/src/routes/profile.js
const express = require('express');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');
const { isValidEmail, isValidUsername, isValidPhoneNumber, isValidName, isValidAddress, isValidCityCountry, isValidZipcode } = require('../utils/validation');

const router = express.Router();

// Update user and business profile
router.put('/', authenticateJWT, async (req, res) => {
  const {
    email,
    username,
    phone_number,
    first_name,
    last_name,
    business_name,
    description,
    logo_url,
    address,
    city,
    zipcode,
  } = req.body;
  const errors = [];

  // Input validation
  if (email && !isValidEmail(email)) errors.push('Correo electrónico inválido');
  if (username && !isValidUsername(username)) errors.push('Nombre de usuario inválido (3-20 caracteres, solo letras, números y guiones)');
  if (phone_number && !isValidPhoneNumber(phone_number)) errors.push('Número de teléfono inválido (formato: +56912345678)');
  if (first_name && !isValidName(first_name)) errors.push('Nombre inválido (2-50 caracteres, solo letras y espacios)');
  if (last_name && !isValidName(last_name)) errors.push('Apellido inválido (2-50 caracteres, solo letras y espacios)');
  if (business_name && !isValidName(business_name)) errors.push('Nombre del negocio inválido (2-50 caracteres, solo letras y espacios)');
  if (address && !isValidAddress(address)) errors.push('Dirección inválida (5-100 caracteres)');
  if (city && !isValidCityCountry(city)) errors.push('Ciudad inválida (2-50 caracteres, solo letras y espacios)');
  if (zipcode && !isValidZipcode(zipcode)) errors.push('Código postal inválido (5-10 caracteres, alfanumérico)');
  if (description && description.length > 500) errors.push('Descripción demasiado larga (máximo 500 caracteres)');
  if (logo_url && !/^https?:\/\/[^\s/$.?#].[^\s]*$/.test(logo_url)) errors.push('URL del logo inválida');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const normalizedEmail = email ? email.toLowerCase() : undefined;
  const normalizedUsername = username ? username.toLowerCase() : undefined;

  try {
    // Check for conflicts
    const existingUser = await prisma.users.findFirst({
      where: {
        AND: [
          { id: { not: req.user.id } },
          {
            OR: [
              normalizedEmail ? { email: normalizedEmail } : {},
              normalizedUsername ? { username: normalizedUsername } : {},
              phone_number ? { phone_number } : {},
            ],
          },
        ],
      },
    });

    if (existingUser) {
      if (normalizedEmail && existingUser.email === normalizedEmail) errors.push('El correo ya está registrado');
      if (normalizedUsername && existingUser.username === normalizedUsername) errors.push('El nombre de usuario ya está en uso');
      if (phone_number && existingUser.phone_number === phone_number) errors.push('El número de teléfono ya está registrado');
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Update user and business in a transaction
    const updatedProfile = await prisma.$transaction(async (tx) => {
      // Update user
      const updatedUser = await tx.users.update({
        where: { id: req.user.id },
        data: {
          email: normalizedEmail,
          username: normalizedUsername,
          phone_number,
          first_name,
          last_name,
          updated_at: new Date(),
        },
      });

      // Update business if any business fields are provided
      let updatedBusiness = null;
      if (business_name || description || logo_url || address || city || zipcode) {
        const existingBusiness = await tx.businesses.findUnique({
          where: { username: req.user.username },
        });
        if (!existingBusiness) {
          throw new Error('Negocio no encontrado');
        }

        updatedBusiness = await tx.businesses.update({
          where: { username: req.user.username },
          data: {
            username: normalizedUsername || existingBusiness.username,
            business_name,
            description,
            logo_url,
            address,
            city,
            zipcode,
            updated_at: new Date(),
          },
        });
      }

      return { user: updatedUser, business: updatedBusiness };
    });

    res.status(200).json({
      user: {
        id: updatedProfile.user.id,
        email: updatedProfile.user.email,
        username: updatedProfile.user.username,
        phone_number: updatedProfile.user.phone_number,
        first_name: updatedProfile.user.first_name,
        last_name: updatedProfile.user.last_name,
        plan: updatedProfile.user.plan,
      },
      business: updatedProfile.business || null,
    });
  } catch (error) {
    console.error('Error al actualizar perfil:', error.message, error.stack);
    res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
});

module.exports = router;