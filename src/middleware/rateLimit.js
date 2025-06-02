// server/src/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: { error: 'Demasiados intentos de registro, intenta de nuevo en 15 minutos' },
});

module.exports = { registerLimiter };