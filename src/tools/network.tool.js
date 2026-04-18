import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

export async function pingHost({ target, count = 4 }) {
  try {
    logger.info(`Ping: ${target} (count=${count})`);
    const { stdout, stderr } = await execAsync(
      `ping -c ${Math.min(count, 10)} -W 5 ${target}`,
      { timeout: 30000 }
    );
    return { success: true, output: (stdout + stderr).trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout ? err.stdout.trim() : `Ping failed: ${err.message}`,
    };
  }
}

export async function tracerouteHost({ target }) {
  try {
    logger.info(`Traceroute: ${target}`);
    const { stdout, stderr } = await execAsync(
      `traceroute -m 15 -w 3 ${target}`,
      { timeout: 60000 }
    );
    return { success: true, output: (stdout + stderr).trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout ? err.stdout.trim() : `Traceroute failed: ${err.message}`,
    };
  }
}

export const pingToolDefinition = {
  name: 'ping_host',
  description: 'Executa ping para um host/IP a partir do servidor NOC. Útil para verificar conectividade.',
  input_schema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'IP ou hostname alvo do ping' },
      count: { type: 'number', description: 'Número de pacotes (padrão: 4, máximo: 10)' },
    },
    required: ['target'],
  },
};

export const tracerouteToolDefinition = {
  name: 'traceroute_host',
  description: 'Executa traceroute para um host/IP a partir do servidor NOC. Útil para identificar problemas de roteamento.',
  input_schema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'IP ou hostname alvo do traceroute' },
    },
    required: ['target'],
  },
};
