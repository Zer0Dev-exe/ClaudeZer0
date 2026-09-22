import crypto from 'crypto';

const validTokens = new Set();

export function login(username, password) {
  const expectedUser = process.env.CLAUDEZER0_USER || 'admin';
  const expectedPass = process.env.CLAUDEZER0_PASSWORD || 'claudezer0';

  if (username === expectedUser && password === expectedPass) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    return { success: true, token, username };
  }

  return { success: false, message: 'Usuario o contraseña incorrectos' };
}

export function validateToken(token) {
  if (!token) return false;
  return validTokens.has(token);
}

export function logout(token) {
  if (token) validTokens.delete(token);
  return { success: true };
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (validateToken(token)) {
    req.userToken = token;
    return next();
  }

  return res.status(401).json({ success: false, error: 'Acceso no autorizado. Inicia sesión.' });
}
