// Harness tests for the e2e Docker stack setup (node --test, no Docker needed).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MISSING_TOKEN_MESSAGE, agentsToken, seedArgs, upArgs } from '../compose-stack.js'

const TOKEN = 'ghp_example_token_value'

function recorder() {
  const lines = []
  return { lines, log: (message) => lines.push(String(message)) }
}

test('an explicit HEALTHFLOW_AGENTS_TOKEN wins and the GitHub CLI is not asked', () => {
  let asked = false
  const { lines, log } = recorder()
  const token = agentsToken({
    env: { HEALTHFLOW_AGENTS_TOKEN: TOKEN },
    runGhAuthToken: () => { asked = true; return { status: 0, stdout: 'other' } },
    log,
  })
  assert.equal(token, TOKEN)
  assert.equal(asked, false)
  assert.deepEqual(lines, [])
})

test('without the variable it falls back to the GitHub CLI login and never logs the token', () => {
  const { lines, log } = recorder()
  const token = agentsToken({ env: {}, runGhAuthToken: () => ({ status: 0, stdout: `${TOKEN}\n` }), log })
  assert.equal(token, TOKEN)
  assert.equal(lines.length, 1)
  assert.ok(lines.every((line) => !line.includes(TOKEN)), 'the token must never be logged')
})

test('with neither source it stops with instructions instead of a failed Docker build', () => {
  const { log } = recorder()
  assert.throws(
    () => agentsToken({ env: {}, runGhAuthToken: () => ({ status: 1, stdout: '' }), log }),
    { message: MISSING_TOKEN_MESSAGE },
  )
  assert.throws(
    () => agentsToken({ env: {}, runGhAuthToken: () => ({ status: 0, stdout: '   \n' }), log }),
    { message: MISSING_TOKEN_MESSAGE },
  )
})

test('every run rebuilds the services and the seed image', () => {
  assert.ok(upArgs().includes('--build'), 'services must be rebuilt')
  assert.deepEqual(seedArgs().slice(-4), ['run', '--rm', '--build', 'seed'])
})
