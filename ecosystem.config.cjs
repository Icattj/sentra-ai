module.exports = {
  apps: [{
    name: 'sentra-ai',
    script: 'server.js',
    cwd: '/home/openclaw/sentra-ai',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      SENTRA_PORT: '3005',
      SENTRA_API_KEY: process.env.SENTRA_API_KEY || 'sk-sentra-change-me',
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
      AWS_REGION: 'us-west-2',
      SENTRA_AWS_REGION: 'us-west-2',
      BEDROCK_REGION: 'us-west-2',
      BEDROCK_MODEL: 'us.anthropic.claude-sonnet-4-6',
      MAX_TOKENS: '8192',
      LOG_REQUESTS: 'true'
    }
  }]
}
