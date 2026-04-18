import Anthropic from '@anthropic-ai/sdk';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import prisma from '../database/client.js';

export default class BaseAgent {
  constructor(name, systemPrompt, tools = []) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.toolHandlers = {};
    this.client = null;
  }

  async getClientAndModel() {
    let apiKey = config.claude.apiKey;
    let model = config.claude.model;

    // Try to get from DB
    const settings = await prisma.settings.findMany({
      where: { key: { in: ['claude_api_key', 'claude_model'] } }
    });

    const dbKey = settings.find(s => s.key === 'claude_api_key');
    const dbModel = settings.find(s => s.key === 'claude_model');

    if (dbKey && dbKey.value) {
      // Import decrypt only when needed to avoid circular deps or just use it
      const { decrypt } = await import('../utils/crypto.js');
      apiKey = dbKey.encrypted ? decrypt(dbKey.value) : dbKey.value;
    }
    
    if (dbModel && dbModel.value) {
      model = dbModel.value;
    }

    if (!apiKey) throw new Error('CLAUDE_API_KEY não configurada no banco ou .env');
    
    if (!this.client || this.client.apiKey !== apiKey) {
      this.client = new Anthropic({ apiKey });
    }
    
    return { client: this.client, model };
  }

  registerTool(definition, handler) {
    this.tools.push(definition);
    this.toolHandlers[definition.name] = handler;
  }

  async executeToolCall(toolName, toolInput) {
    const handler = this.toolHandlers[toolName];
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    try {
      const result = await handler(toolInput);
      return JSON.stringify(result);
    } catch (err) {
      logger.error(`Tool ${toolName} error: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  }

  async run(userMessage, context = {}) {
    const { client, model } = await this.getClientAndModel();
    const messages = [{ role: 'user', content: userMessage }];

    logger.info(`[${this.name}] Processing: ${userMessage.substring(0, 100)}...`);

    let response = await client.messages.create({
      model: model,
      max_tokens: 4096,
      system: this.systemPrompt,
      tools: this.tools.length > 0 ? this.tools : undefined,
      messages,
    });

    const allToolResults = [];

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        logger.info(`[${this.name}] Calling tool: ${toolUse.name}`, toolUse.input);

        const result = await this.executeToolCall(toolUse.name, toolUse.input);

        allToolResults.push({
          tool: toolUse.name,
          input: toolUse.input,
          output: result,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: model,
        max_tokens: 4096,
        system: this.systemPrompt,
        tools: this.tools,
        messages,
      });
    }

    const textContent = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    logger.info(`[${this.name}] Response generated (${textContent.length} chars)`);

    return {
      text: textContent,
      toolsUsed: allToolResults,
      usage: response.usage,
    };
  }

  async runStreaming(userMessage, onChunk) {
    const { client, model } = await this.getClientAndModel();
    const messages = [{ role: 'user', content: userMessage }];

    let fullContent = [];
    let allToolResults = [];

    const streamResponse = async () => {
      const stream = client.messages.stream({
        model: model,
        max_tokens: 4096,
        system: this.systemPrompt,
        tools: this.tools.length > 0 ? this.tools : undefined,
        messages,
      });

      let currentToolUse = null;
      let toolInput = '';

      stream.on('text', (text) => {
        if (onChunk) onChunk({ type: 'text', text });
      });

      const finalMessage = await stream.finalMessage();
      return finalMessage;
    };

    let response = await streamResponse();
    fullContent.push(...response.content);

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        if (onChunk) onChunk({ type: 'tool_start', tool: toolUse.name, input: toolUse.input });

        const result = await this.executeToolCall(toolUse.name, toolUse.input);
        allToolResults.push({ tool: toolUse.name, input: toolUse.input, output: result });

        if (onChunk) onChunk({ type: 'tool_result', tool: toolUse.name, output: result });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await streamResponse();
      fullContent.push(...response.content);
    }

    const textContent = fullContent
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return { text: textContent, toolsUsed: allToolResults };
  }
}
