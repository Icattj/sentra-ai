// ── Sentra AI — OpenAI-compatible API for MAGI Council ──────────────────────
// Port 3005 · Direct Bedrock calls · SSE streaming · 100% OpenAI-compatible
import Fastify from 'fastify'
import cors from '@fastify/cors'
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.SENTRA_PORT || '3005', 10)
const API_KEY = process.env.SENTRA_API_KEY || 'sk-sentra-magi-2026'
const AWS_REGION = process.env.SENTRA_AWS_REGION || process.env.BEDROCK_REGION || 'us-west-2'
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-6'
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '8192', 10)
const LOG_REQUESTS = process.env.LOG_REQUESTS !== 'false'

// ── Load agent definitions ──────────────────────────────────────────────────
const AGENTS_FILE = join(__dirname, 'agents.json')
let AGENTS
try {
  AGENTS = JSON.parse(readFileSync(AGENTS_FILE, 'utf8'))
} catch (err) {
  console.error(`[FATAL] Cannot load agents.json: ${err.message}`)
  process.exit(1)
}

// Build model-name → agent-id mapping
const MODEL_MAP = {}
for (const [id, agent] of Object.entries(AGENTS)) {
  MODEL_MAP[`magi-${id}`] = id
}
MODEL_MAP['magi-auto'] = '_auto'
MODEL_MAP['magi-council'] = '_council'

// All valid model names for /v1/models
const ALL_MODELS = Object.keys(MODEL_MAP)

// ── Bedrock client ──────────────────────────────────────────────────────────
console.log('[INIT] Creating Bedrock client with region:', AWS_REGION)
const bedrock = new BedrockRuntimeClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
})

// ── Formatting prompt (shared across agents) ────────────────────────────────
const FORMAT_PROMPT = `
FORMATTING RULES (always follow):
- Use **bold** for key terms and emphasis
- Use ## headings and ### subheadings to structure longer responses
- Use bullet points (- ) and numbered lists for clarity
- Use tables (| col | col |) when comparing data
- Use \`code\` for technical terms, commands, filenames
- Use > blockquotes for important callouts
- Use emoji naturally to make responses feel alive 🎯
- Break text into short paragraphs — never wall of text
- Start with a direct answer, then elaborate
- Be expressive, warm, and professional — not robotic
`.trim()

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return 'chatcmpl-' + crypto.randomBytes(12).toString('base64url')
}

function unixNow() {
  return Math.floor(Date.now() / 1000)
}

/** Rough token estimate (~4 chars per token for English, conservative) */
function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

/** Build system prompt for an agent */
function buildSystemPrompt(agentId) {
  const agent = AGENTS[agentId]
  if (!agent) return 'You are a helpful AI assistant.'
  return `${agent.soul}\n\n${FORMAT_PROMPT}`
}

/** Convert OpenAI messages array to Anthropic format */
function convertMessages(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { system: '', anthropicMessages: [] }
  }

  let system = ''
  const anthropicMessages = []

  for (const msg of messages) {
    const role = msg.role || 'user'
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n')
        : String(msg.content || '')

    if (role === 'system') {
      system += (system ? '\n\n' : '') + content
    } else if (role === 'assistant') {
      anthropicMessages.push({ role: 'assistant', content })
    } else {
      // 'user', 'tool', 'function' → all map to user
      anthropicMessages.push({ role: 'user', content })
    }
  }

  // Anthropic requires messages to start with 'user' and alternate
  // Merge consecutive same-role messages
  const merged = []
  for (const msg of anthropicMessages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += '\n\n' + msg.content
    } else {
      merged.push({ ...msg })
    }
  }

  // Ensure starts with user
  if (merged.length > 0 && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: '(Continue from where we left off.)' })
  }

  // Ensure alternating by inserting filler
  const fixed = []
  for (let i = 0; i < merged.length; i++) {
    if (i > 0 && fixed[fixed.length - 1].role === merged[i].role) {
      const fillerRole = merged[i].role === 'user' ? 'assistant' : 'user'
      fixed.push({ role: fillerRole, content: '(Acknowledged.)' })
    }
    fixed.push(merged[i])
  }

  return { system, anthropicMessages: fixed }
}

/** Resolve which agent to use */
function resolveAgent(modelName) {
  const agentKey = MODEL_MAP[modelName]
  if (!agentKey) return null
  if (agentKey === '_auto') return 'michael' // default routing
  if (agentKey === '_council') return '_council'
  return agentKey
}

/** Format an OpenAI-style error */
function oaiError(code, message, type = 'invalid_request_error', param = null) {
  return {
    error: { message, type, param, code }
  }
}

// ── Bedrock streaming call ──────────────────────────────────────────────────

async function* streamBedrockChat(systemPrompt, messages, options = {}) {
  const {
    modelId = DEFAULT_MODEL_ID,
    maxTokens = MAX_TOKENS,
    temperature,
    topP,
    signal
  } = options

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages
  }
  if (temperature !== undefined) body.temperature = temperature
  if (topP !== undefined) body.top_p = topP

  console.log('[BEDROCK] Sending request, model:', modelId, 'messages:', messages.length)

  const cmd = new InvokeModelWithResponseStreamCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  })

  let resp
  try {
    resp = await bedrock.send(cmd, signal ? { abortSignal: signal } : undefined)
    console.log('[BEDROCK] Got response object')
  } catch (sendErr) {
    console.error('[BEDROCK] send() error:', sendErr.name, sendErr.message)
    throw sendErr
  }

  let inputTokens = 0
  let outputTokens = 0

  for await (const event of resp.body) {
    if (signal?.aborted) break
    if (event.chunk) {
      const json = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
      if (json.type === 'content_block_delta' && json.delta?.text) {
        yield { type: 'text', text: json.delta.text }
      }
      if (json.type === 'message_start' && json.message?.usage) {
        inputTokens = json.message.usage.input_tokens || 0
      }
      if (json.type === 'message_delta' && json.usage) {
        outputTokens = json.usage.output_tokens || 0
      }
    }
  }

  yield { type: 'usage', inputTokens, outputTokens }
}

/** Non-streaming Bedrock call */
async function invokeBedrockChat(systemPrompt, messages, options = {}) {
  const {
    modelId = DEFAULT_MODEL_ID,
    maxTokens = MAX_TOKENS,
    temperature,
    topP
  } = options

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages
  }
  if (temperature !== undefined) body.temperature = temperature
  if (topP !== undefined) body.top_p = topP

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  })

  const resp = await bedrock.send(cmd)
  const result = JSON.parse(new TextDecoder().decode(resp.body))

  return {
    content: result.content?.[0]?.text || '',
    inputTokens: result.usage?.input_tokens || 0,
    outputTokens: result.usage?.output_tokens || 0,
    stopReason: result.stop_reason || 'end_turn'
  }
}

// ── Council roundtable ──────────────────────────────────────────────────────

const COUNCIL_ORDER = [
  'metis', 'sophia', 'rafael', 'azrael', 'remiel', 'samael',
  'uriel', 'zadkiel', 'michael', 'gabriel', 'raguel', 'sarael'
]

async function* streamCouncilRoundtable(userMessages, options = {}) {
  const { system: userSystem, anthropicMessages } = convertMessages(userMessages)
  const userText = anthropicMessages.map(m => m.content).join('\n\n')

  // Each agent responds briefly, then sarael synthesizes
  const agentsToRun = COUNCIL_ORDER.filter(a => a !== 'sarael')
  let roundtableContext = `## Council Roundtable\n**Topic:** ${userText}\n\n`

  for (const agentId of agentsToRun) {
    const agent = AGENTS[agentId]
    const sysPrompt = `${agent.soul}\n\nYou are in a Council roundtable discussion. Keep your response focused and under 150 words. Address the topic directly from your expertise.`

    yield { type: 'text', text: `\n\n### 🗣️ ${agent.name} (${agent.role})\n` }

    let agentResponse = ''
    for await (const chunk of streamBedrockChat(sysPrompt, [{ role: 'user', content: userText }], {
      ...options,
      maxTokens: 1024
    })) {
      if (chunk.type === 'text') {
        yield chunk
        agentResponse += chunk.text
      }
    }
    roundtableContext += `**${agent.name}:** ${agentResponse}\n\n`
  }

  // Sarael synthesizes
  const sarael = AGENTS.sarael
  const synthPrompt = `${sarael.soul}\n\nSynthesize the following Council roundtable discussion. Identify key agreements, disagreements, and end with one unanswered question.`

  yield { type: 'text', text: `\n\n### 🔮 Sarael (Synthesis)\n` }

  for await (const chunk of streamBedrockChat(synthPrompt, [{ role: 'user', content: roundtableContext }], {
    ...options,
    maxTokens: 2048
  })) {
    if (chunk.type === 'text') {
      yield chunk
    }
    if (chunk.type === 'usage') {
      yield chunk
    }
  }
}

// ── Fastify server ──────────────────────────────────────────────────────────

const app = Fastify({
  logger: LOG_REQUESTS ? { level: 'info' } : false,
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024 // 10MB
})

await app.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'] })

// ── Auth middleware ──────────────────────────────────────────────────────────

function authenticate(request, reply) {
  const authHeader = request.headers.authorization
  if (!authHeader) {
    reply.code(401).send(oaiError(401, 'Missing Authorization header', 'authentication_error'))
    return false
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token !== API_KEY) {
    reply.code(401).send(oaiError(401, 'Invalid API key', 'authentication_error'))
    return false
  }
  return true
}

// ── GET /v1/models ──────────────────────────────────────────────────────────

app.get('/v1/models', async (request, reply) => {
  if (!authenticate(request, reply)) return

  const models = ALL_MODELS.map(modelName => {
    const agentKey = MODEL_MAP[modelName]
    const agent = AGENTS[agentKey] || null
    return {
      id: modelName,
      object: 'model',
      created: 1700000000,
      owned_by: 'sentra-ai',
      permission: [],
      root: modelName,
      parent: null,
      ...(agent ? { description: `${agent.name} — ${agent.desc}` } : {})
    }
  })

  return {
    object: 'list',
    data: models
  }
})

// ── POST /v1/chat/completions ───────────────────────────────────────────────

app.post('/v1/chat/completions', async (request, reply) => {
  if (!authenticate(request, reply)) return

  const body = request.body || {}
  const {
    model = 'magi-auto',
    messages,
    stream = false,
    temperature,
    top_p,
    max_tokens,
    user,
    n = 1,
    stop,
    presence_penalty,
    frequency_penalty
  } = body

  // Validate model
  if (!MODEL_MAP[model]) {
    return reply.code(400).send(oaiError(
      'model_not_found',
      `Model '${model}' not found. Available: ${ALL_MODELS.join(', ')}`,
      'invalid_request_error',
      'model'
    ))
  }

  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return reply.code(400).send(oaiError(
      'invalid_request_error',
      'messages is required and must be a non-empty array',
      'invalid_request_error',
      'messages'
    ))
  }

  const agentId = resolveAgent(model)
  const completionId = generateId()
  const created = unixNow()

  const bedrockOptions = {
    modelId: DEFAULT_MODEL_ID,
    maxTokens: max_tokens || MAX_TOKENS,
    temperature: temperature !== undefined ? temperature : undefined,
    topP: top_p !== undefined ? top_p : undefined
  }

  if (LOG_REQUESTS) {
    app.log?.info({ model, agentId, stream, messageCount: messages.length, user }, 'chat.completions request')
  }

  // ── Council roundtable mode ─────────────────────────────────────────────
  if (agentId === '_council') {
    if (stream) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      })

      const sendSSE = (data) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      // Role chunk first
      sendSSE({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
      })

      try {
        for await (const chunk of streamCouncilRoundtable(messages, bedrockOptions)) {
          if (chunk.type === 'text') {
            sendSSE({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }]
            })
          }
        }
      } catch (err) {
        app.log?.error(err, 'Council roundtable streaming error')
      }

      sendSSE({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })
      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()
      return
    }

    // Non-streaming council — collect all text
    let fullText = ''
    for await (const chunk of streamCouncilRoundtable(messages, bedrockOptions)) {
      if (chunk.type === 'text') fullText += chunk.text
    }

    return {
      id: completionId,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: fullText },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: estimateTokens(messages.map(m => typeof m.content === 'string' ? m.content : '').join('')),
        completion_tokens: estimateTokens(fullText),
        total_tokens: estimateTokens(messages.map(m => typeof m.content === 'string' ? m.content : '').join('') + fullText)
      }
    }
  }

  // ── Single agent mode ───────────────────────────────────────────────────
  const agentSystemPrompt = buildSystemPrompt(agentId)
  const { system: userSystem, anthropicMessages } = convertMessages(messages)
  const fullSystem = userSystem
    ? `${agentSystemPrompt}\n\n${userSystem}`
    : agentSystemPrompt

  if (stream) {
    // ── Streaming response (hijack + direct write) ─────────────────────────
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    })

    const sendSSE = (data) => {
      if (!raw.destroyed) raw.write('data: ' + JSON.stringify(data) + '\n\n')
    }

    sendSSE({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
    })

    try {
      const gen = streamBedrockChat(fullSystem, anthropicMessages, bedrockOptions)
      for await (const chunk of gen) {
        if (raw.destroyed) break
        if (chunk.type === 'text') {
          sendSSE({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }]
          })
        }
      }
    } catch (err) {
      console.error('[STREAM ERROR]', err.message)
    }

    sendSSE({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })
    if (!raw.destroyed) {
      raw.write('data: [DONE]\n\n')
      raw.end()
    }
    return


  } else {
    // ── Non-streaming response ────────────────────────────────────────────
    try {
      const result = await invokeBedrockChat(fullSystem, anthropicMessages, bedrockOptions)

      const stopReason = result.stopReason === 'end_turn' ? 'stop'
        : result.stopReason === 'max_tokens' ? 'length'
        : 'stop'

      return {
        id: completionId,
        object: 'chat.completion',
        created,
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: stopReason
        }],
        usage: {
          prompt_tokens: result.inputTokens,
          completion_tokens: result.outputTokens,
          total_tokens: result.inputTokens + result.outputTokens
        }
      }
    } catch (err) {
      app.log?.error(err, 'Non-streaming Bedrock error')
      const statusCode = err.$metadata?.httpStatusCode || 500
      return reply.code(statusCode).send(oaiError(
        statusCode,
        `Bedrock error: ${err.message}`,
        'server_error'
      ))
    }
  }
})

// ── Health check ────────────────────────────────────────────────────────────

app.get('/health', async () => ({
  status: 'ok',
  service: 'sentra-ai',
  version: '1.0.0',
  agents: Object.keys(AGENTS).length,
  models: ALL_MODELS.length,
  uptime: process.uptime()
}))

// ── Root ────────────────────────────────────────────────────────────────────

app.get('/', async () => ({
  name: 'Sentra AI',
  version: '1.0.0',
  description: 'OpenAI-compatible API for MAGI Council agents',
  endpoints: {
    chat: 'POST /v1/chat/completions',
    models: 'GET /v1/models',
    health: 'GET /health'
  }
}))

// ── 404 handler ─────────────────────────────────────────────────────────────

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send(oaiError(404, `Not found: ${request.method} ${request.url}`, 'not_found'))
})

// ── Error handler ───────────────────────────────────────────────────────────

app.setErrorHandler((error, request, reply) => {
  app.log?.error(error)
  const statusCode = error.statusCode || 500
  reply.code(statusCode).send(oaiError(
    statusCode,
    error.message || 'Internal server error',
    'server_error'
  ))
})

// ── Start ───────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: PORT, host: '127.0.0.1' })
  console.log(`
╔═══════════════════════════════════════════╗
║          🧠  Sentra AI  v1.0.0           ║
║   OpenAI-compatible MAGI Council API     ║
╠═══════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(30)}║
║  Models:   ${String(ALL_MODELS.length).padEnd(30)}║
║  Agents:   ${String(Object.keys(AGENTS).length).padEnd(30)}║
║  Bedrock:  ${DEFAULT_MODEL_ID.padEnd(30)}║
║  Region:   ${AWS_REGION.padEnd(30)}║
╠═══════════════════════════════════════════╣
║  POST /v1/chat/completions               ║
║  GET  /v1/models                         ║
║  GET  /health                            ║
╚═══════════════════════════════════════════╝
  `.trim())
} catch (err) {
  console.error('[FATAL] Failed to start:', err.message)
  process.exit(1)
}
