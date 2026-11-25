import jwt from 'jsonwebtoken';

export function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), name: user.name, personalId: user.personalId, color: user.color },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Please sign in.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Session expired. Sign in again.' });
  }
}
