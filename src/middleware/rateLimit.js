const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 200,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
});

const publicBusinessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: 'Too many requests for business info, please try again later.',
  standardHeaders: true,
});

const availabilityLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Too many availability requests, please try again later.',
  standardHeaders: true,
});

const appointmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many appointment requests, please try again later.',
  standardHeaders: true,
});

const resendVerificationLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 horas
  max: 3,
  message: 'Too many resend attempts, please try again tomorrow.',
  standardHeaders: true,
});

module.exports = {
  generalLimiter,
  publicBusinessLimiter,
  availabilityLimiter,
  appointmentLimiter,
  resendVerificationLimiter,
};