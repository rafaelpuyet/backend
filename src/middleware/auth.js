// server/src/middleware/auth.js
const jwt = require('jsonwebtoken');

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { user_id: decoded.user_id, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

module.exports = { authenticateJWT };