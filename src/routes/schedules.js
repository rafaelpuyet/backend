// server/src/routes/schedules.js
const express = require('express');
const prisma = require('../config/prisma');
const { authenticateJWT } = require('../middleware/auth');
const { generateTimeSlots } = require('../utils/scheduleUtils');

const router = express.Router();

// Create or update default schedule
router.post('/', authenticateJWT, async (req, res) => {
  const { days, start_time, end_time, slot_duration, blocks } = req.body;
  const errors = [];

  // Validation
  if (!days || !Array.isArray(days) || days.length === 0) {
    errors.push('Se requiere al menos un día de la semana');
  }
  if (days && !days.every(day => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day))) {
    errors.push('Días de la semana inválidos');
  }
  if (!start_time || !/^\d{2}:\d{2}$/.test(start_time)) {
    errors.push('Hora de inicio inválida (formato: HH:MM)');
  }
  if (!end_time || !/^\d{2}:\d{2}$/.test(end_time)) {
    errors.push('Hora de fin inválida (formato: HH:MM)');
  }
  if (!slot_duration || ![15, 30, 45, 60].includes(slot_duration)) {
    errors.push('Duración de slot inválida (15, 30, 45 o 60 minutos)');
  }
  if (blocks && !Array.isArray(blocks)) {
    errors.push('Bloques deben ser un arreglo');
  }
  if (blocks) {
    blocks.forEach((block, index) => {
      if (!block.start_time || !/^\d{2}:\d{2}$/.test(block.start_time)) {
        errors.push(`Bloque ${index + 1}: Hora de inicio inválida`);
      }
      if (!block.end_time || !/^\d{2}:\d{2}$/.test(block.end_time)) {
        errors.push(`Bloque ${index + 1}: Hora de fin inválida`);
      }
      if (block.day_of_week && !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(block.day_of_week)) {
        errors.push(`Bloque ${index + 1}: Día de la semana inválido`);
      }
    });
  }

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

    await prisma.schedules.deleteMany({ where: { business_id: business.id } });
    await prisma.schedule_blocks.deleteMany({ where: { business_id: business.id } });

    const schedulePromises = days.map(day =>
      prisma.schedules.create({
        data: {
          business_id: business.id,
          day_of_week: day,
          start_time,
          end_time,
          slot_duration,
          created_at: new Date(),
          updated_at: new Date(),
        },
      })
    );
    await Promise.all(schedulePromises);

    if (blocks && blocks.length > 0) {
      const blockPromises = blocks.map(block =>
        prisma.schedule_blocks.create({
          data: {
            business_id: business.id,
            day_of_week: block.day_of_week || null,
            start_time: block.start_time,
            end_time: block.end_time,
            created_at: new Date(),
            updated_at: new Date(),
          },
        })
      );
      await Promise.all(blockPromises);
    }

    res.status(201).json({ message: 'Agenda configurada exitosamente' });
  } catch (error) {
    console.error('Error al configurar agenda:', error.message, error.stack);
    res.status(500).json({ error: 'Error al configurar la agenda' });
  }
});

// Get default schedule
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const business = await prisma.businesses.findUnique({
      where: { username: req.user.username },
    });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const schedules = await prisma.schedules.findMany({
      where: { business_id: business.id },
      select: {
        day_of_week: true,
        start_time: true,
        end_time: true,
        slot_duration: true,
      },
    });

    const blocks = await prisma.schedule_blocks.findMany({
      where: { business_id: business.id },
      select: {
        day_of_week: true,
        start_time: true,
        end_time: true,
      },
    });

    res.json({ schedules, blocks });
  } catch (error) {
    console.error('Error al obtener agenda:', error.message, error.stack);
    res.status(500).json({ error: 'Error al obtener la agenda' });
  }
});

// Create schedule exception
router.post('/exceptions', authenticateJWT, async (req, res) => {
  const { date, type, start_time, end_time } = req.body;
  const errors = [];

  // Validation
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('Fecha inválida (formato: YYYY-MM-DD)');
  }
  if (!type || !['disabled', 'enabled', 'custom'].includes(type)) {
    errors.push('Tipo inválido (disabled, enabled, custom)');
  }
  if (type === 'custom') {
    if (!start_time || !/^\d{2}:\d{2}$/.test(start_time)) {
      errors.push('Hora de inicio inválida (formato: HH:MM)');
    }
    if (!end_time || !/^\d{2}:\d{2}$/.test(end_time)) {
      errors.push('Hora de fin inválida (formato: HH:MM)');
    }
  }

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

    // Check for existing exception on the same date
    const existingException = await prisma.schedule_exceptions.findFirst({
      where: { business_id: business.id, date: new Date(date) },
    });
    if (existingException) {
      return res.status(400).json({ error: 'Ya existe una excepción para esta fecha' });
    }

    const exception = await prisma.schedule_exceptions.create({
      data: {
        business_id: business.id,
        date: new Date(date),
        type,
        start_time: type === 'custom' ? start_time : null,
        end_time: type === 'custom' ? end_time : null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    res.status(201).json(exception);
  } catch (error) {
    console.error('Error al crear excepción:', error.message, error.stack);
    res.status(500).json({ error: 'Error al crear la excepción' });
  }
});

// Get available slots for a date
router.get('/available-slots', async (req, res) => {
  const { date, business_username } = req.query;
  const errors = [];

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('Fecha inválida (formato: YYYY-MM-DD)');
  }
  if (!business_username) {
    errors.push('Nombre de usuario del negocio requerido');
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const business = await prisma.businesses.findUnique({
      where: { username: business_username },
    });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleString('en-US', { weekday: 'long' });

    // Check for exception
    const exception = await prisma.schedule_exceptions.findFirst({
      where: {
        business_id: business.id,
        date: {
          gte: new Date(date),
          lt: new Date(new Date(date).setDate(dateObj.getDate() + 1)),
        },
      },
    });

    if (exception && exception.type === 'disabled') {
      return res.json({ slots: [] });
    }

    let schedule = null;
    let blocks = [];
    let startTime = '09:00';
    let endTime = '18:00';
    let slotDuration = 45;

    if (exception && exception.type === 'custom') {
      startTime = exception.start_time;
      endTime = exception.end_time;
      slotDuration = 45; // Default for custom exceptions
    } else if (exception && exception.type === 'enabled') {
      schedule = await prisma.schedules.findFirst({
        where: { business_id: business.id, day_of_week: dayOfWeek },
      });
      if (schedule) {
        startTime = schedule.start_time;
        endTime = schedule.end_time;
        slotDuration = schedule.slot_duration;
      }
    } else {
      schedule = await prisma.schedules.findFirst({
        where: { business_id: business.id, day_of_week: dayOfWeek },
      });
      if (!schedule) {
        return res.json({ slots: [] });
      }
      startTime = schedule.start_time;
      endTime = schedule.end_time;
      slotDuration = schedule.slot_duration;

      blocks = await prisma.schedule_blocks.findMany({
        where: {
          business_id: business.id,
          OR: [{ day_of_week: dayOfWeek }, { day_of_week: null }],
        },
      });
    }

    // Get appointments for the date
    const appointments = await prisma.appointments.findMany({
      where: {
        business_id: business.id,
        start_time: {
          gte: new Date(date),
          lt: new Date(new Date(date).setDate(dateObj.getDate() + 1)),
        },
      },
    });

    const slots = generateTimeSlots(startTime, endTime, slotDuration, blocks, [exception].filter(Boolean), appointments);

    res.json({ slots });
  } catch (error) {
    console.error('Error al obtener slots disponibles:', error.message, error.stack);
    res.status(500).json({ error: 'Error al obtener slots disponibles' });
  }
});

module.exports = router;