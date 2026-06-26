import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
    this.geminiClient = null;
  }

  async getConfig() {
    let apiKey, model;
    const provider = config.aiProvider;

    if (provider === 'gemini') {
      apiKey = config.gemini.apiKey;
      model = config.gemini.model;

      const settings = await prisma.settings.findMany({
        where: { key: { in: ['gemini_api_key', 'gemini_model'] } }
      });

      const dbKey = settings.find(s => s.key === 'gemini_api_key');
      const dbModel = settings.find(s => s.key === 'gemini_model');

      if (dbKey && dbKey.value) {
        const { decrypt } = await import('../utils/crypto.js');
        apiKey = dbKey.encrypted ? decrypt(dbKey.value) : dbKey.value;
      }
      if (dbModel && dbModel.value) {
        model = dbModel.value;
      }

      if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no banco ou .env');
    } else {
      apiKey = config.claude.apiKey;
      model = config.claude.model;

      const settings = await prisma.settings.findMany({
        where: { key: { in: ['claude_api_key', 'claude_model'] } }
      });

      const dbKey = settings.find(s => s.key === 'claude_api_key');
      const dbModel = settings.find(s => s.key === 'claude_model');

      if (dbKey && dbKey.value) {
        const { decrypt } = await import('../utils/crypto.js');
        apiKey = dbKey.encrypted ? decrypt(dbKey.value) : dbKey.value;
      }
      if (dbModel && dbModel.value) {
        model = dbModel.value;
      }

      if (!apiKey) throw new Error('CLAUDE_API_KEY não configurada no banco ou .env');
    }

    return { apiKey, model, provider };
  }

  convertToolsForGemini() {
    if (this.tools.length === 0) return undefined;

    return this.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
    }));
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

  async runClaude(userMessage) {
    const { apiKey, model } = await this.getConfig();

    if (!this.client || this.client.apiKey !== apiKey) {
      this.client = new Anthropic({ apiKey });
    }

    const messages = [{ role: 'user', content: userMessage }];
    logger.info(`[${this.name}] Processing with Claude: ${userMessage.substring(0, 100)}...`);

    let response = await this.client.messages.create({
      model,
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
        allToolResults.push({ tool: toolUse.name, input: toolUse.input, output: result });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await this.client.messages.create({
        model,
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
    return { text: textContent, toolsUsed: allToolResults, usage: response.usage };
  }

  async runGemini(userMessage) {
    const { apiKey, model } = await this.getConfig();

    if (!this.geminiClient || this._geminiApiKey !== apiKey) {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      this._geminiApiKey = apiKey;
    }

    const geminiTools = this.convertToolsForGemini();
    logger.info(`[${this.name}] Processing with Gemini: ${userMessage.substring(0, 100)}...`);

    const modelInstance = this.geminiClient.getGenerativeModel({
      model,
      systemInstruction: this.systemPrompt,
      tools: geminiTools ? [{ functionDeclarations: geminiTools }] : undefined,
    });

    const chat = modelInstance.startChat();
    const result = await chat.sendMessage(userMessage);
    const response = result.response;

    const allToolResults = [];
    let textContent = response.text() || '';

    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      for (const fc of functionCalls) {
        logger.info(`[${this.name}] Calling tool: ${fc.name}`, fc.args);
        const toolResult = await this.executeToolCall(fc.name, fc.args);
        allToolResults.push({ tool: fc.name, input: fc.args, output: toolResult });

        const continueResult = await chat.sendMessage([
          { functionResponse: { name: fc.name, response: JSON.parse(toolResult) } }
        ]);

        textContent = continueResult.response.text() || textContent;
      }
    }

    logger.info(`[${this.name}] Response generated (${textContent.length} chars)`);
    return { text: textContent, toolsUsed: allToolResults, usage: {} };
  }

  async run(userMessage, context = {}) {
    const provider = config.aiProvider;
    if (provider === 'gemini') {
      return this.runGemini(userMessage);
    }
    return this.runClaude(userMessage);
  }

  async runStreaming(userMessage, onChunk) {
    const provider = config.aiProvider;

    if (provider === 'gemini') {
      return this.runStreamingGemini(userMessage, onChunk);
    }
    return this.runStreamingClaude(userMessage, onChunk);
  }

  async runStreamingClaude(userMessage, onChunk) {
    const { apiKey, model } = await this.getConfig();

    if (!this.client || this.client.apiKey !== apiKey) {
      this.client = new Anthropic({ apiKey });
    }

    const messages = [{ role: 'user', content: userMessage }];
    let fullContent = [];
    let allToolResults = [];

    const streamResponse = async () => {
      const stream = this.client.messages.stream({
        model,
        max_tokens: 4096,
        system: this.systemPrompt,
        tools: this.tools.length > 0 ? this.tools : undefined,
        messages,
      });

      stream.on('text', (text) => {
        if (onChunk) onChunk({ type: 'text', text });
      });

      return await stream.finalMessage();
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
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
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

  async runStreamingGemini(userMessage, onChunk) {
    const { apiKey, model } = await this.getConfig();

    if (!this.geminiClient || this._geminiApiKey !== apiKey) {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      this._geminiApiKey = apiKey;
    }

    const geminiTools = this.convertToolsForGemini();
    logger.info(`[${this.name}] Processing with Gemini: ${userMessage.substring(0, 100)}...`);

    const modelInstance = this.geminiClient.getGenerativeModel({
      model,
      systemInstruction: this.systemPrompt,
      tools: geminiTools ? [{ functionDeclarations: geminiTools }] : undefined,
    });

    const chat = modelInstance.startChat();
    const result = await chat.sendMessageStream(userMessage);

    let textContent = '';
    const allToolResults = [];

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        textContent += text;
        if (onChunk) onChunk({ type: 'text', text });
      }
    }

    const finalResponse = await result.response;
    const functionCalls = finalResponse.functionCalls();

    if (functionCalls && functionCalls.length > 0) {
      for (const fc of functionCalls) {
        if (onChunk) onChunk({ type: 'tool_start', tool: fc.name, input: fc.args });
        const toolResult = await this.executeToolCall(fc.name, fc.args);
        allToolResults.push({ tool: fc.name, input: fc.args, output: toolResult });
        if (onChunk) onChunk({ type: 'tool_result', tool: fc.name, output: toolResult });

        const continueResult = await chat.sendMessageStream([
          { functionResponse: { name: fc.name, response: JSON.parse(toolResult) } }
        ]);

        for await (const chunk of continueResult.stream) {
          const text = chunk.text();
          if (text) {
            textContent += text;
            if (onChunk) onChunk({ type: 'text', text });
          }
        }
      }
    }

    logger.info(`[${this.name}] Response generated (${textContent.length} chars)`);
    return { text: textContent, toolsUsed: allToolResults };
  }
}
