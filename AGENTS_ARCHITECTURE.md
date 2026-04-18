# Agent Architecture - NOC Agent 35

This document explains the architecture of the AI agents within the NOC Agent 35 application. It is designed to be easily understandable by other LLMs and human developers.

## 1. Overview
The NOC Agent 35 system implements a Multi-Agent architecture using **Claude's Native Tool Use (Function Calling)**. Unlike systems that rely on external Model Context Protocol (MCP) servers, this architecture embeds the tools natively within the Node.js backend. This allows for direct, synchronous interaction with the application's database (Prisma) and local execution environment, ensuring low latency and high security.

The system is composed of an Orchestrator/Classifier agent (SupportAgent) and multiple Specialist agents (MikrotikAgent, LinuxAgent).

## 2. Core Components

### 2.1 BaseAgent (\`src/agents/base-agent.js\`)
The foundation of all agents. It acts as a wrapper around the \`@anthropic-ai/sdk\`.
- **Capabilities:**
  - Manages the Claude API connection and retrieves credentials/model preferences from the database.
  - Registers JavaScript functions as Native Tools via \`registerTool()\`.
  - Handles the conversation loop, intercepting \`tool_use\` blocks from the LLM, executing the corresponding JS function natively, and returning the \`tool_result\` back to the LLM.
  - Supports both synchronous execution (\`run()\`) and streaming execution (\`runStreaming()\`) for real-time frontend integration.

### 2.2 SupportAgent (\`src/agents/support-agent.js\`)
The entry point, classifier, and orchestrator.
- **Role:** Receives raw input from webhooks (WhatsApp, Zabbix) or the web dashboard.
- **Functionality:** 
  - Uses tools like \`search_device\` to look up the exact device ID (UUID) from the database based on the user's natural language input.
  - Classifies the intent and generates a strict JSON output determining which specialist to call (e.g., \`action: "route_to_specialist"\`, \`deviceType: "mikrotik"\`).
  - Does NOT perform diagnostics. Its sole purpose is routing and identification.

### 2.3 Specialist Agents
These agents possess domain-specific knowledge and tools to interact directly with network equipment and servers. They are prompted to act autonomously, bypassing rigid formats, and solving the user's request conversationally.

#### MikrotikAgent (\`src/agents/mikrotik-agent.js\`)
- **Domain:** MikroTik RouterOS.
- **Tools:** 
  - \`ssh_mikrotik_exec\`: Executes RouterOS commands securely via SSH.
  - \`ping_host\` & \`traceroute_host\`: Network diagnostics originating from the NOC server.
- **Behavior:** Autonomously executes diagnostic commands (e.g., \`/ip address print\`, \`/interface print\`) or applies configurations. For high-risk commands, it proposes the script and asks for user confirmation ("SIM"/"NÃO") before execution.

#### LinuxAgent (\`src/agents/linux-agent.js\`)
- **Domain:** Linux Servers.
- **Tools:** 
  - \`ssh_linux_exec\`: Executes Bash commands on remote Linux servers via SSH.
  - \`ping_host\` & \`traceroute_host\`.
- **Behavior:** Similar autonomous operation, capable of analyzing logs, checking system resources (\`uptime\`, \`free\`, \`df\`), or restarting services.

## 3. Communication & Routing Flow

### 3.1 Webhooks (WhatsApp/Zabbix) - \`src/routes/webhook.routes.js\`
1. Message arrives and is processed.
2. Passed to \`SupportAgent.classify()\`.
3. If \`route_to_specialist\`, the application creates a background Task and passes the context to the corresponding Specialist Agent.
4. The Specialist Agent runs \`diagnose()\` or executes a solution if the admin replied "SIM".

### 3.2 Dashboard (Web UI) - \`src/server.js\`
1. The frontend emits a \`chat:message\` via Socket.IO.
2. If the selected agent is \`support\`, it streams the output using \`runStreaming()\`.
3. The server intercepts the JSON output of the \`SupportAgent\`.
4. It extracts the \`deviceType\` and automatically instantiates the Specialist Agent.
5. The Specialist Agent's text and tool use are streamed directly back to the frontend in real-time, providing a seamless transition from Support -> Specialist without user intervention.

## 4. Security & Protections
- **Tool-Level Blocking:** Tools like \`ssh_mikrotik_exec\` contain a \`BLOCKED_COMMANDS\` array (e.g., \`/system reset\`, \`rm -rf /\`). If the LLM attempts to use these, the tool returns a generic error, preventing catastrophic failure.
- **Database Segregation:** Passwords are encrypted (AES-256-GCM) in the database and only decrypted in-memory inside the tool functions at the moment of the SSH handshake.
- **Approval Gates:** The Specialist agents are prompted to request explicit human confirmation for configuration changes.

## 5. Summary for AI Context
If you are an AI reading this:
- **Do not assume an external MCP server exists.** Tool execution is local.
- If you need to modify an agent's behavior, edit its system prompt in \`src/agents/<agent-name>.js\`.
- If you need to add a tool, write the JS function in \`src/tools/\`, define its schema, and call \`this.registerTool()\` in the Agent's constructor.
- The Dashboard routing logic relies on catching a JSON block from the \`SupportAgent\` inside \`src/server.js\` Socket.IO events.
