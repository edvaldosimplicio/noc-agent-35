import { Router } from 'express';
import * as taskService from '../services/task.service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { status, source, priority, limit } = req.query;
    const tasks = await taskService.getAllTasks({
      status, source, priority, limit: limit ? parseInt(limit) : 50,
    });
    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await taskService.getTaskStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.get('/number/:taskNumber', async (req, res, next) => {
  try {
    const task = await taskService.getTaskByNumber(parseInt(req.params.taskNumber));
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

export default router;
