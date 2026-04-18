import { Router } from 'express';
import prisma from '../database/client.js';

const router = Router();

router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { title } = req.body;
    const session = await prisma.chatSession.create({
      data: { title: title || `Chat ${new Date().toLocaleString('pt-BR')}` },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    await prisma.chatSession.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) { next(err); }
});

export default router;
