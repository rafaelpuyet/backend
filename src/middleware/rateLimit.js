const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 200,
  message: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.',
  standardHeaders: true,
});

const publicBusinessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: 'Demasiadas solicitudes para información de negocio, intenta de nuevo más tarde.',
  standardHeaders: true,
});

const availabilityLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Demasiadas solicitudes de disponibilidad, intenta de nuevo más tarde.',
  standardHeaders: true,
});

const appointmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Demasiadas solicitudes de citas, intenta de nuevo más tarde.',
  standardHeaders: true,
});

const resendVerificationLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 3,
  message: 'Demasiados intentos de reenvío, intenta de nuevo mañana.',
  standardHeaders: true,
});

module.exports = {
  generalLimiter,
  publicBusinessLimiter,
  availabilityLimiter,
  appointmentLimiter,
  resendVerificationLimiter,
};