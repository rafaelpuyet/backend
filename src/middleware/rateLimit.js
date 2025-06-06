const rateLimit = require('express-rate-limit');

const businessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 100,
  message: 'Too many requests for business info'
});

const availabilityLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Too many requests for availability'
});

const appointmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many appointment requests'
});

const resendLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 3,
  message: 'Too many verification resend requests'
});

module.exports = { businessLimiter, availabilityLimiter, appointmentLimiter, resendLimiter };