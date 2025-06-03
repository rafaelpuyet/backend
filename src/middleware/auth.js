// server/src/middleware/auth.js
const jwt = require('jsonwebtoken');

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación no proporcionado o inválido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id) {
      return res.status(401).json({ error: 'Token inválido: datos incompletos' });
    }
    req.user = { id: decoded.id };
    next();
  } catch (error) {
    console.error('Error en verificación de token:', error.message, error.stack);
    return res.status(401).json({ error: `Token inválido: ${error.message}` });
  }
};

module.exports = { authenticateJWT };