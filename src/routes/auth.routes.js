import { Router } from 'express';
import config from '../config/index.js';
import { generateToken } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password required' });
  }
  if (password !== config.dashboardPassword) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  const token = generateToken();
  res.json({ success: true, token });
});

router.get('/verify', (req, res) => {
  res.json({ success: true, message: 'Token is valid' });
});

export default router;
