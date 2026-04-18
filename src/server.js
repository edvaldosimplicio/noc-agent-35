import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import config from './config/index.js';
import logger from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { authMiddleware } from './middleware/auth.middleware.js';

import authRoutes from './routes/auth.routes.js';
import deviceRoutes from './routes/device.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import taskRoutes from './routes/task.routes.js';
import chatRoutes from './routes/chat.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

import prisma from './database/client.js';
import SupportAgent from './agents/support-agent.js';
import MikrotikAgent from './agents/mikrotik-agent.js';
import LinuxAgent from './agents/linux-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(join(__dirname, '..', 'frontend', 'dist')));

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);

// Protected routes
app.use('/api/devices', authMiddleware, deviceRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO for real-time dashboard chat
const agents = {
  support: new SupportAgent(),
  mikrotik: new MikrotikAgent(),
  linux: new LinuxAgent(),
};

io.on('connection', (socket) => {
  logger.info(`Dashboard client connected: ${socket.id}`);

  socket.on('chat:message', async ({ sessionId, message, agentType = 'support' }) => {
    try {
      const agent = agents[agentType];
      if (!agent) {
        socket.emit('chat:error', { error: `Agent "${agentType}" not found` });
        return;
      }

      // Save user message
      await prisma.chatMessage.create({
        data: { sessionId, role: 'user', content: message },
      });

      // Update session title if first message
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: { messages: true },
      });
      if (session && session.messages.length <= 1) {
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { title: message.substring(0, 80) },
        });
      }

      // Run agent with streaming
      socket.emit('chat:typing', { agentType });
      
      const result = await agent.runStreaming(message, (chunk) => {
        // If it's SupportAgent, we hide the text stream to prevent raw JSON from showing up,
        // but we still emit tool events.
        if (agentType !== 'support' && chunk.type === 'text') {
          socket.emit('chat:chunk', { text: chunk.text });
        } else if (chunk.type === 'tool_start') {
          socket.emit('chat:tool', { status: 'start', tool: chunk.tool, input: chunk.input });
        } else if (chunk.type === 'tool_result') {
          socket.emit('chat:tool', { status: 'result', tool: chunk.tool, output: chunk.output });
        }
      });

      // Handle automatic routing if Support Agent was used
      if (agentType === 'support') {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const classification = JSON.parse(jsonMatch[0]);
            
            // Emit the natural part of the text (if any) before the JSON
            const naturalText = result.text.replace(/```json\s*\{[\s\S]*\}\s*```|\{[\s\S]*\}/, '').trim();
            if (naturalText) {
              socket.emit('chat:chunk', { text: naturalText });
            }

            if (classification.action === 'route_to_specialist') {
              const { deviceId, deviceType, deviceName, originalRequest } = classification;
              const specialistAgent = agents[deviceType];
              
              if (specialistAgent) {
                const taskNum = Math.floor(Math.random() * 10000);
                const prompt = `Você recebeu uma solicitação do NOC.

**Dispositivo:** ${deviceName} (ID: ${deviceId})
**Tipo:** ${deviceType === 'mikrotik' ? 'MikroTik RouterOS' : 'Linux'}
**Task:** #TASK-${taskNum}
**Solicitação:** ${originalRequest}

Acesse o equipamento, analise e atenda à solicitação da forma mais autônoma possível. Use o deviceId "${deviceId}" em todas as chamadas de tools.`;

                socket.emit('chat:chunk', { text: `\n\n🔄 **Encaminhando para especialista em ${deviceType}...**\n\n` });
                socket.emit('chat:typing', { agentType: deviceType });

                const specialistResult = await specialistAgent.runStreaming(prompt, (chunk) => {
                  if (chunk.type === 'text') {
                    socket.emit('chat:chunk', { text: chunk.text });
                  } else if (chunk.type === 'tool_start') {
                    socket.emit('chat:tool', { status: 'start', tool: chunk.tool, input: chunk.input });
                  } else if (chunk.type === 'tool_result') {
                    socket.emit('chat:tool', { status: 'result', tool: chunk.tool, output: chunk.output });
                  }
                });

                result.text += `\n\n🔄 **Encaminhando para especialista em ${deviceType}...**\n\n${specialistResult.text}`;
                result.toolsUsed.push(...specialistResult.toolsUsed);
              }
            } else if (classification.action === 'unknown') {
              socket.emit('chat:chunk', { text: classification.message || '\n\nNão consegui identificar o equipamento ou a ação desejada.' });
            }
          } catch (e) {
            logger.warn(`Could not parse JSON for specialist routing: ${e.message}`);
          }
        } else {
          // If no JSON was found, just emit the whole text
          socket.emit('chat:chunk', { text: result.text });
        }
      }

      // Save assistant message
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: result.text,
          agentUsed: agentType,
          toolCalls: result.toolsUsed.length > 0 ? JSON.stringify(result.toolsUsed) : null,
        },
      });

      socket.emit('chat:complete', {
        text: result.text,
        agentUsed: agentType,
        toolsUsed: result.toolsUsed,
      });
    } catch (err) {
      logger.error(`Chat error: ${err.message}`);
      socket.emit('chat:error', { error: err.message });
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Dashboard client disconnected: ${socket.id}`);
  });
});

// Make io available to webhook routes for real-time updates
app.set('io', io);

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return notFoundHandler(req, res);
  }
  res.sendFile(join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.use(errorHandler);

// Start server
httpServer.listen(config.port, '0.0.0.0', () => {
  logger.info(`🚀 NOC Agent 35 running on http://0.0.0.0:${config.port}`);
  logger.info(`📊 Dashboard: http://localhost:${config.port}`);
  logger.info(`🔌 WebSocket: ws://localhost:${config.port}`);
  logger.info(`📱 WhatsApp webhook: POST /api/webhooks/evolution`);
  logger.info(`📊 Zabbix webhook: POST /api/webhooks/zabbix`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});
