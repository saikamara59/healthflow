// Pure helpers behind tests/global-setup.js, kept separate so the harness
// itself is unit tested (tests/harness/*.test.mjs) without Docker or GitHub.

export const COMPOSE_FILES = ['-f', '../docker-compose.yml', '-f', '../docker-compose.test.yml']

export const MISSING_TOKEN_MESSAGE =
  'HEALTHFLOW_AGENTS_TOKEN is not set and the GitHub CLI is not logged in. ' +
  'Run `gh auth login` with an account that can read saikamara59/healthflow-agents, ' +
  'or export HEALTHFLOW_AGENTS_TOKEN with a token that has read access to it.'

// The backend image installs the private healthflow-agents package, so the build
// needs a GitHub token as a BuildKit secret. CI sets HEALTHFLOW_AGENTS_TOKEN; locally
// we fall back to the GitHub CLI's login. The token is returned, never logged.
export function agentsToken({ env, runGhAuthToken, log }) {
  if (env.HEALTHFLOW_AGENTS_TOKEN) return env.HEALTHFLOW_AGENTS_TOKEN
  const gh = runGhAuthToken()
  const token = gh.status === 0 ? String(gh.stdout || '').trim() : ''
  if (token) {
    log('🔑 Using your GitHub CLI login to install healthflow-agents')
    return token
  }
  throw new Error(MISSING_TOKEN_MESSAGE)
}

// Long-running services are rebuilt on every run; see seedArgs for the one-shot seed.
export function upArgs() {
  return ['compose', ...COMPOSE_FILES, 'up', '-d', '--build', '--wait', 'backend', 'frontend', 'redis']
}

// --build keeps the seed image on the same code as the backend; a cached seed
// image would recreate an older schema and break every per-worker reset.
export function seedArgs() {
  return ['compose', ...COMPOSE_FILES, 'run', '--rm', '--build', 'seed']
}
