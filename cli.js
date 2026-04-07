#!/usr/bin/env node

// Sentra AI CLI — Talk to MAGI Council agents from the terminal
// Pure Node.js, zero dependencies. Requires Node 18+.

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, argv, env, exit } from 'node:process';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = env.SENTRA_API_URL || 'http://127.0.0.1:3005/v1/chat/completions';
const API_KEY = env.SENTRA_API_KEY || 'sk-sentra-magi-2026';

// ─── Agent Registry ──────────────────────────────────────────────────────────

const AGENTS = {
  'magi-auto':    { name: 'MAGI Auto',        model: 'magi-auto',    color: '\x1b[97m',  emoji: '🧠', desc: 'Auto-routes to best agent' },
  'magi-council': { name: 'MAGI Council',      model: 'magi-council', color: '\x1b[96m',  emoji: '🏛️', desc: 'Full roundtable discussion' },
  rafael:         { name: 'Rafael',            model: 'magi-rafael',  color: '\x1b[33m',  emoji: '🧭', desc: 'The Architect — Strategy & orchestration' },
  uriel:          { name: 'Uriel',             model: 'magi-uriel',   color: '\x1b[31m',  emoji: '🔥', desc: 'The Validator — Testing & verification' },
  michael:        { name: 'Michael',           model: 'magi-michael', color: '\x1b[36m',  emoji: '🛡️', desc: 'The Wise Advisor — Risk & wisdom' },
  gabriel:        { name: 'Gabriel',           model: 'magi-gabriel', color: '\x1b[35m',  emoji: '📣', desc: 'The Voice — Marketing & brand' },
  raguel:         { name: 'Raguel',            model: 'magi-raguel',  color: '\x1b[32m',  emoji: '🤝', desc: 'The Friend — Outreach & relationships' },
  samael:         { name: 'Samael',            model: 'magi-samael',  color: '\x1b[90m',  emoji: '⚖️', desc: 'System Guardian — Security & logic' },
  sarael:         { name: 'Sarael',            model: 'magi-sarael',  color: '\x1b[34m',  emoji: '🔮', desc: 'The Scribe — Synthesis & analysis' },
  azrael:         { name: 'Azrael',            model: 'magi-azrael',  color: '\x1b[93m',  emoji: '💸', desc: 'The Auditor — Finance & costs' },
  remiel:         { name: 'Remiel',            model: 'magi-remiel',  color: '\x1b[94m',  emoji: '🛡️', desc: 'The Sentry — Legal & compliance' },
  zadkiel:        { name: 'Zadkiel',           model: 'magi-zadkiel', color: '\x1b[95m',  emoji: '🛠️', desc: 'The Builder — Product & design' },
  metis:          { name: 'Metis',             model: 'magi-metis',   color: '\x1b[92m',  emoji: '🔍', desc: 'The Researcher — Competitor intel' },
  sophia:         { name: 'Sophia',            model: 'magi-sophia',  color: '\x1b[91m',  emoji: '💎', desc: 'The Philosopher — Deep analysis' },
};

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED   = '\x1b[31m';
const MAGENTA = '\x1b[35m';

// ─── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(args) {
  const result = { agent: 'magi-auto', interactive: false, help: false, version: false, query: '' };
  const positional = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--agent' || arg === '-a') {
      i++;
      if (i < args.length) result.agent = args[i].toLowerCase();
    } else if (arg.startsWith('--agent=')) {
      result.agent = arg.split('=')[1].toLowerCase();
    } else if (arg === '-i' || arg === '--interactive') {
      result.interactive = true;
    } else if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-v' || arg === '--version') {
      result.version = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
    i++;
  }

  result.query = positional.join(' ');
  return result;
}

// ─── Help & Version ──────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${BOLD}${CYAN}🧠 Sentra AI${RESET} — MAGI Council CLI

${BOLD}USAGE${RESET}
  sentra ${DIM}"your question"${RESET}                  Ask the default agent
  sentra ${DIM}--agent rafael "your question"${RESET}   Ask a specific agent
  sentra ${DIM}-i${RESET}                               Interactive chat mode

${BOLD}OPTIONS${RESET}
  ${GREEN}-a, --agent <name>${RESET}   Select agent (default: magi-auto)
  ${GREEN}-i, --interactive${RESET}    Start interactive REPL
  ${GREEN}-h, --help${RESET}           Show this help
  ${GREEN}-v, --version${RESET}        Show version

${BOLD}AGENTS${RESET}`);

  for (const [id, agent] of Object.entries(AGENTS)) {
    console.log(`  ${agent.color}${agent.emoji} ${id.padEnd(12)}${RESET} ${DIM}${agent.desc}${RESET}`);
  }

  console.log(`
${BOLD}EXAMPLES${RESET}
  sentra "How should I architect this payment system?"
  sentra --agent rafael "Strategic analysis of competitor X"
  sentra --agent uriel "Review this code for bugs"
  sentra -i

${BOLD}ENVIRONMENT${RESET}
  SENTRA_API_KEY    API key (default: sk-sentra-magi-2026)
  SENTRA_API_URL    API endpoint (default: http://127.0.0.1:3005/v1/chat/completions)
`);
}

function printVersion() {
  console.log('sentra-ai v1.0.0');
}

// ─── Streaming API Call ──────────────────────────────────────────────────────

async function streamChat(messages, agentId, onToken) {
  const agentDef = AGENTS[agentId] || AGENTS['magi-auto'];
  const model = agentDef.model;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // skip empty / comments

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onToken(delta.content);
          }
        } catch {
          // non-JSON data line, skip
        }
      }
    }
  }

  return fullContent;
}

// ─── Single Query Mode ───────────────────────────────────────────────────────

async function singleQuery(query, agentId) {
  const agent = AGENTS[agentId] || AGENTS['magi-auto'];
  const label = `${agent.color}${BOLD}[${agent.emoji} ${agent.name}]${RESET} `;

  stderr.write(`${DIM}Connecting to ${agent.emoji} ${agent.name}...${RESET}\n`);

  const messages = [{ role: 'user', content: query }];

  let firstToken = true;
  try {
    await streamChat(messages, agentId, (token) => {
      if (firstToken) {
        stdout.write(label);
        firstToken = false;
      }
      stdout.write(token);
    });
    stdout.write('\n');
  } catch (err) {
    stderr.write(`\n${RED}${BOLD}Error:${RESET} ${err.message}\n`);
    exit(1);
  }
}

// ─── Interactive Mode ────────────────────────────────────────────────────────

async function interactiveMode(initialAgent) {
  let agentId = initialAgent;
  let agent = AGENTS[agentId] || AGENTS['magi-auto'];
  const history = [];

  console.log(`
${BOLD}${CYAN}🧠 Sentra AI${RESET} — Connected to MAGI Council
${DIM}Agent: ${agent.color}${agent.emoji} ${agent.name}${RESET} ${DIM}| Type ${GREEN}/help${RESET}${DIM} for commands${RESET}
`);

  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: `${BOLD}${GREEN}> ${RESET}`,
    terminal: true,
  });

  const prompt = () => rl.prompt();

  const handleCommand = (input) => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/help':
        console.log(`
${BOLD}Commands:${RESET}
  ${GREEN}/agent <name>${RESET}  — Switch to a different agent
  ${GREEN}/agents${RESET}       — List all available agents
  ${GREEN}/clear${RESET}        — Clear conversation history
  ${GREEN}/model${RESET}        — Show current agent
  ${GREEN}/help${RESET}         — Show this help
  ${GREEN}/exit${RESET}         — Quit
`);
        return true;

      case '/agents':
        console.log(`\n${BOLD}Available Agents:${RESET}`);
        for (const [id, a] of Object.entries(AGENTS)) {
          const marker = id === agentId ? ` ${YELLOW}← current${RESET}` : '';
          console.log(`  ${a.color}${a.emoji} ${id.padEnd(12)}${RESET} ${DIM}${a.desc}${RESET}${marker}`);
        }
        console.log('');
        return true;

      case '/agent':
        if (parts.length < 2) {
          console.log(`${RED}Usage: /agent <name>${RESET}`);
          return true;
        }
        const newAgent = parts[1].toLowerCase();
        if (!AGENTS[newAgent]) {
          console.log(`${RED}Unknown agent: ${newAgent}${RESET}`);
          console.log(`${DIM}Try /agents to see available options${RESET}`);
          return true;
        }
        agentId = newAgent;
        agent = AGENTS[agentId];
        console.log(`${CYAN}Switched to ${agent.color}${agent.emoji} ${agent.name}${RESET} ${DIM}(${agent.desc})${RESET}\n`);
        return true;

      case '/clear':
        history.length = 0;
        console.log(`${DIM}Conversation history cleared.${RESET}\n`);
        return true;

      case '/model':
        console.log(`${DIM}Current agent: ${agent.color}${agent.emoji} ${agent.name} (${agentId})${RESET}\n`);
        return true;

      case '/exit':
      case '/quit':
      case '/q':
        console.log(`${DIM}Goodbye! 👋${RESET}`);
        rl.close();
        exit(0);

      default:
        console.log(`${RED}Unknown command: ${cmd}${RESET} ${DIM}(try /help)${RESET}\n`);
        return true;
    }
  };

  prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      prompt();
      continue;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      handleCommand(input);
      prompt();
      continue;
    }

    // Send message to API
    history.push({ role: 'user', content: input });

    const label = `${agent.color}${BOLD}[${agent.emoji} ${agent.name}]${RESET} `;
    let firstToken = true;

    try {
      const reply = await streamChat([...history], agentId, (token) => {
        if (firstToken) {
          stdout.write('\n' + label);
          firstToken = false;
        }
        stdout.write(token);
      });

      if (firstToken) {
        // No tokens received
        stdout.write(`\n${label}${DIM}(no response)${RESET}`);
      }

      stdout.write('\n\n');
      history.push({ role: 'assistant', content: reply || '' });
    } catch (err) {
      stderr.write(`\n${RED}${BOLD}Error:${RESET} ${err.message}\n\n`);
    }

    prompt();
  }

  // Handle Ctrl+D
  console.log(`\n${DIM}Goodbye! 👋${RESET}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(argv.slice(2));

  if (args.help) {
    printHelp();
    exit(0);
  }

  if (args.version) {
    printVersion();
    exit(0);
  }

  // Validate agent
  if (!AGENTS[args.agent]) {
    stderr.write(`${RED}Unknown agent: ${args.agent}${RESET}\n`);
    stderr.write(`${DIM}Available: ${Object.keys(AGENTS).join(', ')}${RESET}\n`);
    exit(1);
  }

  if (args.interactive || (!args.query && stdin.isTTY)) {
    // Interactive mode if -i flag or no query and TTY
    if (!args.query && !args.interactive && stdin.isTTY) {
      // No args at all and in a terminal — default to interactive
      await interactiveMode(args.agent);
    } else {
      await interactiveMode(args.agent);
    }
  } else if (args.query) {
    await singleQuery(args.query, args.agent);
  } else {
    // Piped input — read from stdin
    let input = '';
    const decoder = new TextDecoder();
    for await (const chunk of stdin) {
      input += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    }
    if (input.trim()) {
      await singleQuery(input.trim(), args.agent);
    } else {
      printHelp();
    }
  }
}

main().catch((err) => {
  stderr.write(`${RED}Fatal: ${err.message}${RESET}\n`);
  exit(1);
});
