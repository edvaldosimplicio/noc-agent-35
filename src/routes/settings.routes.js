import { Router } from 'express';
import prisma from '../database/client.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';

const router = Router();

const SENSITIVE_KEYS = ['claude_api_key', 'evolution_api_key', 'zabbix_webhook_token', 'dashboard_password', 'encryption_key'];

router.get('/', async (req, res, next) => {
  try {
    const settings = await prisma.settings.findMany();
    const safe = settings.map(s => ({
      ...s,
      value: s.encrypted ? '••••••••' : s.value,
    }));
    res.json({ success: true, data: safe });
  } catch (err) { next(err); }
});

router.get('/:key', async (req, res, next) => {
  try {
    const setting = await prisma.settings.findUnique({ where: { key: req.params.key } });
    if (!setting) return res.status(404).json({ success: false, error: 'Setting not found' });
    res.json({
      success: true,
      data: { ...setting, value: setting.encrypted ? '••••••••' : setting.value },
    });
  } catch (err) { next(err); }
});

router.put('/:key', async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'Value is required' });
    }

    const isSensitive = SENSITIVE_KEYS.includes(req.params.key);
    const storeValue = isSensitive ? encrypt(value) : value;

    const setting = await prisma.settings.upsert({
      where: { key: req.params.key },
      update: { value: storeValue, encrypted: isSensitive },
      create: { key: req.params.key, value: storeValue, encrypted: isSensitive },
    });

    res.json({
      success: true,
      data: { ...setting, value: isSensitive ? '••••••••' : setting.value },
    });
  } catch (err) { next(err); }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ success: false, error: 'Settings array required' });
    }

    const results = [];
    for (const { key, value } of settings) {
      if (!key || value === undefined || value === '••••••••') continue;
      const isSensitive = SENSITIVE_KEYS.includes(key);
      const storeValue = isSensitive ? encrypt(value) : value;

      const setting = await prisma.settings.upsert({
        where: { key },
        update: { value: storeValue, encrypted: isSensitive },
        create: { key, value: storeValue, encrypted: isSensitive },
      });
      results.push({ key, saved: true });
    }

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

router.post('/test-claude', async (req, res, next) => {
  try {
    let { apiKey, model } = req.body;
    
    logger.info(`[Claude Test] Iniciando teste de conexão para o modelo: ${model}`);

    if (!apiKey || apiKey === '••••••••') {
      const setting = await prisma.settings.findUnique({ where: { key: 'claude_api_key' } });
      if (!setting || !setting.value) {
        logger.error('[Claude Test] API Key não encontrada no banco de dados');
        return res.status(400).json({ success: false, error: 'API Key não configurada' });
      }
      apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    }

    if (!model) {
      model = 'claude-3-5-sonnet-20241022';
    }

    const client = new Anthropic({ apiKey });
    
    logger.info(`[Claude Test] Enviando requisição de teste para a Anthropic API...`);
    const response = await client.messages.create({
      model: model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Responda apenas com a palavra OK' }]
    });

    logger.info(`[Claude Test] Conexão bem-sucedida! Resposta recebida: ${response.content[0].text}`);
    res.json({ success: true, message: 'Conexão com a API Claude estabelecida com sucesso!' });
  } catch (err) { 
    logger.error(`[Claude Test] Falha na conexão: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

router.post('/test-evolution', async (req, res, next) => {
  try {
    let { apiUrl, apiKey, instance, phone } = req.body;
    
    logger.info(`[Evolution Test] Iniciando teste para: ${phone}`);

    if (!apiUrl || !instance || !phone) {
      return res.status(400).json({ success: false, error: 'URL, Instância e WhatsApp Admin são obrigatórios' });
    }

    if (!apiKey || apiKey === '••••••••') {
      const setting = await prisma.settings.findUnique({ where: { key: 'evolution_api_key' } });
      if (!setting || !setting.value) {
        return res.status(400).json({ success: false, error: 'API Key não configurada' });
      }
      apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    }

    const formattedPhone = phone.replace(/\\D/g, '');
    const cleanUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    const url = `${cleanUrl}/message/sendText/${instance}`;
    
    logger.info(`[Evolution Test] Enviando POST para ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ number: formattedPhone, text: '🤖 Olá! Esta é uma mensagem de teste do NOC Agent 35.' }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error(`[Evolution Test] Erro: ${JSON.stringify(data)}`);
      return res.status(400).json({ success: false, error: data.message || JSON.stringify(data) });
    }

    logger.info(`[Evolution Test] Mensagem enviada com sucesso para ${formattedPhone}`);
    res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
  } catch (err) { 
    logger.error(`[Evolution Test] Falha na conexão: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

export default router;
