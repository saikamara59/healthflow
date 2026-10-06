import { spawnSync } from 'node:child_process'

const COMPOSE_FILES = ['-f', '../docker-compose.yml', '-f', '../docker-compose.test.yml']

// The backend image installs the private healthflow-agents package, so the build
// needs a GitHub token as a BuildKit secret. CI sets HEALTHFLOW_AGENTS_TOKEN; locally
// we fall back to the GitHub CLI's login. The token only reaches docker compose's
// environment and is never logged.
function agentsToken() {
  if (process.env.HEALTHFLOW_AGENTS_TOKEN) return process.env.HEALTHFLOW_AGENTS_TOKEN
  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  const token = gh.status === 0 ? gh.stdout.trim() : ''
  if (token) {
    console.log('🔑 Using your GitHub CLI login to install healthflow-agents')
    return token
  }
  throw new Error(
    'HEALTHFLOW_AGENTS_TOKEN is not set and the GitHub CLI is not logged in. ' +
    'Run `gh auth login` with an account that can read saikamara59/healthflow-agents, ' +
    'or export HEALTHFLOW_AGENTS_TOKEN with a token that has read access to it.'
  )
}

const COMPOSE_ENV = {
  ...process.env,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key-not-used',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
}

function dumpLogs() {
  spawnSync('docker', ['compose', ...COMPOSE_FILES, 'logs', 'backend', 'seed'], {
    stdio: 'inherit',
    env: COMPOSE_ENV,
  })
}

export default async function globalSetup() {
  COMPOSE_ENV.HEALTHFLOW_AGENTS_TOKEN = agentsToken()
  console.log('🐳 Starting docker-compose test stack (core services)...')

  // Step 1: Bring up the long-running services and wait for them to be healthy.
  // We exclude the seed service here because it's a one-shot job that exits 0,
  // and --wait treats any exited container as a failure (Docker Compose v5).
  const upResult = spawnSync(
    'docker',
    [
      'compose', ...COMPOSE_FILES,
      'up', '-d', '--build', '--wait',
      'backend', 'frontend', 'redis',
    ],
    { stdio: 'inherit', env: COMPOSE_ENV }
  )
  if (upResult.status !== 0) {
    console.error('❌ docker compose up failed; dumping logs:')
    dumpLogs()
    throw new Error(`docker compose up failed with exit code ${upResult.status}`)
  }

  // Step 2: Run the seed (schema reset) as a one-shot and wait for it to finish.
  // --build keeps the seed image on the same code as the backend; a cached seed
  // image would recreate an older schema and break every per-worker reset.
  console.log('🌱 Running schema seed...')
  const seedResult = spawnSync(
    'docker',
    [
      'compose', ...COMPOSE_FILES,
      'run', '--rm', '--build', 'seed',
    ],
    { stdio: 'inherit', env: COMPOSE_ENV }
  )
  if (seedResult.status !== 0) {
    console.error('❌ seed failed; dumping logs:')
    dumpLogs()
    throw new Error(`seed failed with exit code ${seedResult.status}`)
  }

  console.log('✅ Stack up and seeded')
}
