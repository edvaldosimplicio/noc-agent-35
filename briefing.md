# Briefing: NOC Agent 35

## 📌 Visão Geral do Projeto
O **NOC Agent 35** é um sistema inteligente de monitoramento e suporte para infraestrutura de redes e servidores (NOC - Network Operations Center). Ele atua integrando alertas externos e comandos via chat com agentes autônomos de Inteligência Artificial baseados na API da Anthropic (Claude 3.5 Sonnet).

O sistema permite diagnosticar equipamentos remotamente e sugerir/executar ações corretivas, mantendo o controle total na mão do administrador através de um sistema de aprovação via WhatsApp (Evolution API).

## 🏗 Arquitetura e Tecnologias

### Backend
- **Node.js (Express):** Servidor principal da aplicação que expõe as APIs REST e gerencia o Socket.IO.
- **SQLite + Prisma ORM:** Banco de dados relacional leve para armazenar configurações, histórico de tasks (diagnósticos), dispositivos e sessões de chat.
- **Socket.IO:** Comunicação em tempo real ("streaming") entre o Backend e a Dashboard (Frontend) para o chat com as IAs.
- **Crypto:** Senhas de SSH e credenciais sensíveis das APIs são salvas no banco de dados com criptografia **AES-256-GCM**.

### Frontend
- **React 18 + Vite:** SPA responsiva e otimizada.
- **Tema Customizado:** Design system "Dark Mode" projetado especificamente para interfaces NOC (cores vibrantes baseadas em alertas e status, com foco em usabilidade).
- **Socket.IO Client:** Para receber os tokens de resposta da IA em formato de stream no Dashboard.

## 🤖 Estrutura dos Agentes de IA

A aplicação possui um **Pipeline de Agentes** que trabalham em conjunto:

1. **🧠 Support Agent (O Roteador)**
   - **Responsabilidade:** Receber mensagens iniciais do WhatsApp ou alertas de webhooks do Zabbix.
   - **Fluxo:** Avalia o contexto, identifica qual o equipamento problemático no banco de dados, classifica a prioridade e **encaminha a task** para o agente especialista.
   - **Ferramentas (MCP):** Busca e Listagem de Equipamentos.

2. **🔧 MikroTik Agent (O Especialista em Redes)**
   - **Responsabilidade:** Acessar roteadores via SSH e aplicar metodologias de diagnóstico de rede no RouterOS.
   - **Ferramentas (MCP):** Execução de comandos RouterOS segurizados (possui lista de comandos perigosos bloqueados), Ping, Traceroute.

3. **🐧 Linux Agent (O Especialista em Servidores)**
   - **Responsabilidade:** Acessar servidores Linux via SSH, monitorar recursos (CPU, RAM, Disco) e gerenciar serviços (`systemctl`, `journalctl`).
   - **Ferramentas (MCP):** Execução de shell script segurizados, Ping, Traceroute.

## 🔄 Fluxo de Funcionamento

1. **Gatilho:** O sistema recebe um alerta no endpoint `/api/webhooks/zabbix` ou uma mensagem no WhatsApp via Evolution API.
2. **Classificação:** O `Support Agent` lê o alerta, encontra o ID do dispositivo e cria uma **Task (#TASK-123)** com status `diagnosing`.
3. **Diagnóstico Silencioso:** O especialista (Linux ou MikroTik) entra via SSH no equipamento, colhe as métricas e escreve um relatório com o problema identificado e uma solução em formato de comandos.
4. **Aprovação do Administrador:** O WhatsApp do NOC manda o relatório final para o número do Administrador e muda o status da Task para `awaiting_approval`.
5. **Decisão:** O administrador responde no WhatsApp com:
   - *"SIM #TASK-123"* -> A aprovação é reconhecida, a solução sugerida é aplicada no equipamento pelo agente e o resultado final é retornado.
   - *"NÃO #TASK-123"* -> A task é cancelada preventivamente.

## ⚙️ Gestão da Aplicação (PM2)

O aplicativo backend e o servidor estático (frontend "buildado") rodam num único processo do PM2, o que facilita o acompanhamento no servidor Ubuntu.

**Comandos Úteis:**
- `pm2 logs noc-agent` → Acompanhar erros, conversas e interações da IA.
- `pm2 monit` → Ver uso de CPU e Memória RAM.
- `pm2 restart noc-agent` → Reiniciar o backend (útil após modificar o código ou .env localmente).
- `pm2 list` → Lista de processos ativos.

---
*Briefing gerado e consolidado após o setup completo do ambiente NOC Agent 35.*
