import { test, expect } from '../fixtures'
import path from 'node:path'
import { test as publicTest } from '@playwright/test'

test('Phase 3 Client status ignores an older response after switching views', async ({ authedPage: page }) => {
  await page.goto('/today')
  let releaseActive
  const activeReady = new Promise((resolve) => { releaseActive = resolve })
  let activeStarted
  const started = new Promise((resolve) => { activeStarted = resolve })
  await page.route('**/clients', async (route) => {
    if (route.request().isNavigationRequest()) return route.continue()
    activeStarted()
    await activeReady
    await route.fulfill({ json: [{ id: 'old-active', full_name: 'Old active result', age: 40 }] })
  })
  await page.route('**/clients?archived=true', (route) => {
    if (route.request().isNavigationRequest()) return route.continue()
    return route.fulfill({ json: [{ id: 'current-archive', full_name: 'Current archived result', age: 40 }] })
  })
  await page.goto('/clients')
  await started
  await page.getByRole('link', { name: 'Archived clients', exact: true }).click()
  await expect(page.getByText('Current archived result', { exact: true })).toBeVisible()
  const oldResponse = page.waitForResponse((response) => response.url().endsWith('/clients'))
  releaseActive()
  await oldResponse
  // Wait until the older fetch has completed and React has rendered its callbacks.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText('Current archived result', { exact: true })).toBeVisible()
  await expect(page.getByText('Old active result', { exact: true })).toHaveCount(0)
})

publicTest('Phase 3 documents public demo seeded files are visible and direct upload is denied', async ({ page, request }) => {
  publicTest.skip(process.env.PHASE3_PUBLIC_DEMO !== '1', 'Requires separately seeded upload-disabled synthetic demo')
  const login = await request.post('/auth/login', { data: { email: process.env.PHASE3_DEMO_EMAIL, password: process.env.PHASE3_DEMO_PASSWORD } })
  expect(login.ok()).toBe(true)
  const tokens = await login.json()
  await page.addInitScript((value) => {
    sessionStorage.setItem('hf_token', value.access_token)
    sessionStorage.setItem('hf_refresh', value.refresh_token)
  }, tokens)
  const headers = { Authorization: `Bearer ${tokens.access_token}` }
  expect((await (await request.get('/documents/capabilities', { headers })).json()).upload_enabled).toBe(false)
  const clients = await (await request.get('/clients', { headers })).json()
  const client = clients.find((item) => item.full_name === 'Eleanor Rigby')
  expect(client).toBeTruthy()
  await page.goto(`/clients/${client.id}`)
  await expect(page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload document' })).toHaveCount(0)
  const denied = await request.post(`/clients/${client.id}/documents`, { headers, multipart: { file: { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') } } })
  expect(denied.status()).toBe(503)
  expect((await denied.json()).detail).toBe('Document uploads are disabled')
  await page.goto('/documents/archive')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Document archive', exact: true })).toBeVisible()
})

test('Phase 3 documents shares one rotating refresh across simultaneous requests', async ({ authedPage: page }) => {
  await page.goto('/documents/archive')
  await expect(page.getByText('No archived Documents.')).toBeVisible()
  let refreshes = 0
  page.on('request', (request) => { if (request.url().endsWith('/auth/refresh')) refreshes += 1 })
  const tokens = await page.evaluate(async () => {
    const { default: api } = await import('/src/api/client.js')
    const before = sessionStorage.getItem('hf_refresh')
    sessionStorage.setItem('hf_token', 'expired')
    await Promise.all([api.get('/documents/capabilities'), api.get('/documents/archived'), api.get('/clients')])
    const first = sessionStorage.getItem('hf_refresh')
    sessionStorage.setItem('hf_token', 'expired-again')
    await api.get('/documents/capabilities')
    return [before, first, sessionStorage.getItem('hf_refresh')]
  })
  expect(refreshes).toBe(2)
  expect(new Set(tokens).size).toBe(3)
})

test('Phase 3 documents downloads Word attachments and revokes the temporary URL', async ({ authedPage: page }) => {
  await page.goto('/today')
  await page.route('**/documents/word-fixture/content', (route) => route.fulfill({
    headers: { 'Content-Type': 'application/msword', 'Content-Disposition': "attachment; filename*=UTF-8''synthetic-letter.doc" },
    body: 'Synthetic Word download transport fixture',
  }))
  await page.evaluate(() => {
    window.revokedDocumentUrls = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => { window.revokedDocumentUrls.push(url); revoke(url) }
  })
  const download = page.waitForEvent('download')
  await page.evaluate(async () => {
    const { default: api } = await import('/src/api/client.js')
    await api.openDocument('word-fixture')
  })
  expect((await download).suggestedFilename()).toBe('synthetic-letter.doc')
  await expect.poll(() => page.evaluate(() => window.revokedDocumentUrls.length)).toBe(1)
})

test('Phase 3 documents upload, reuse, Unlink, archive and restore retain only active associations', async ({ authedPage: page }) => {
  await page.goto('/today')
  const headers = { Authorization: `Bearer ${await page.evaluate(() => sessionStorage.getItem('hf_token'))}` }
  const capability = await (await page.request.get('/documents/capabilities', { headers })).json()
  test.skip(!capability.upload_enabled, 'Private synthetic-test environment required')
  const client = (await (await page.request.get('/clients', { headers })).json())[0]
  const enrollment = await (await page.request.post('/enrollments', { headers, data: { client_id: client.id, plan_name: 'Synthetic Document Plan' } })).json()
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Synthetic Document Issue' } })).json()
  const appeal = await (await page.request.post('/appeals', { headers, data: { issue_id: issue.id, title: 'Synthetic Document Appeal' } })).json()
  await page.goto(`/clients/${client.id}`)
  await page.getByLabel('Choose synthetic file').setInputFiles(path.resolve('../demo_documents/synthetic-summary.pdf'))
  await page.getByRole('button', { name: 'Upload document', exact: true }).click()
  const row = page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' }).last()
  await expect(row).toBeVisible()
  const docs = await (await page.request.get(`/clients/${client.id}/documents`, { headers })).json()
  const doc = docs.find((item) => item.display_filename === 'synthetic-summary.pdf')
  const otherId = 'e2e-worker-999'
  expect((await page.request.post('/__test/reset', { data: { worker_id: otherId } })).ok()).toBe(true)
  const outsider = await (await page.request.post('/auth/login', { data: { email: `${otherId}@healthflow.test`, password: 'TestWorker123!' } })).json()
  const outsiderHeaders = { Authorization: `Bearer ${outsider.access_token}` }
  expect((await page.request.get(`/documents/${doc.id}/content`, { headers: outsiderHeaders })).status()).toBe(404)
  expect((await page.request.get(`/clients/${client.id}/documents`, { headers: outsiderHeaders })).status()).toBe(404)
  await page.goto('/enrollments')
  const enrollmentPanel = page.locator('details').filter({ hasText: 'Synthetic Document Plan' })
  await enrollmentPanel.locator('summary').click()
  await enrollmentPanel.getByLabel('Client Document').selectOption(doc.id)
  await enrollmentPanel.getByRole('button', { name: 'Link document', exact: true }).click()
  await expect(enrollmentPanel.locator('.document-row')).toContainText('synthetic-summary.pdf')
  await page.reload()
  await page.goto('/issues')
  await page.reload()
  await page.getByRole('button', { name: /Synthetic Document Issue/ }).click()
  const issuePanel = page.locator('.phase2-detail > .document-panel')
  await issuePanel.getByLabel('Client Document').selectOption(doc.id)
  await issuePanel.getByRole('button', { name: 'Link document', exact: true }).click()
  await expect(issuePanel.locator('.document-row')).toContainText('synthetic-summary.pdf')
  const appealPanel = page.locator('details').filter({ hasText: 'Documents · Synthetic Document Appeal' })
  await appealPanel.locator('summary').click()
  await expect(appealPanel.getByLabel('Client Document')).toBeVisible()
  await appealPanel.getByLabel('Client Document').selectOption(doc.id)
  await appealPanel.getByRole('button', { name: 'Link document', exact: true }).click()
  await expect(issuePanel.getByRole('button', { name: 'Unlink appeal' })).toBeVisible()
  await appealPanel.getByRole('button', { name: 'Unlink appeal' }).click()
  await expect(issuePanel.getByRole('button', { name: 'Unlink appeal' })).toHaveCount(0)
  await expect(appealPanel.locator('.document-row')).toHaveCount(0)
  expect(appeal.id).toBeTruthy()
  await page.goto(`/clients/${client.id}`)
  await page.evaluate(() => sessionStorage.setItem('hf_token', 'expired'))
  const content = page.waitForResponse((response) => response.url().includes(`/documents/${doc.id}/content`) && response.status() === 200)
  const popup = page.waitForEvent('popup')
  await page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' }).getByRole('button', { name: 'Open', exact: true }).click()
  expect((await content).headers()['content-disposition']).toMatch(/^inline/)
  await (await popup).close()
  await page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' }).getByRole('button', { name: 'Unlink issue', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unlink issue', exact: true })).toHaveCount(0)
  await page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' }).getByRole('button', { name: 'Archive document' }).click()
  await expect(page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' })).toHaveCount(0)
  await page.goto('/documents/archive')
  await page.reload()
  const archived = page.locator('.document-row').filter({ hasText: 'synthetic-summary.pdf' })
  await expect(archived.getByRole('button', { name: 'Unlink enrollment' })).toBeVisible()
  await archived.getByRole('button', { name: 'Restore document' }).click()
  await expect(archived).toHaveCount(0)
  const links = await (await page.request.get(`/documents/${doc.id}/links`, { headers })).json()
  expect(links.map((link) => link.target_type)).toEqual(['enrollment'])
  await page.goto(`/clients/${client.id}`)
  await page.reload()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Archive client' }).click()
  await expect(page.getByRole('button', { name: 'Upload document' })).toHaveCount(0)
  await page.goto('/enrollments')
  await enrollmentPanel.locator('summary').click()
  await expect(enrollmentPanel.getByRole('button', { name: 'Link document', exact: true })).toHaveCount(0)
  await page.goto('/appeals')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Issue context' })).toBeVisible()
})

test('Phase 3 documents restores upload controls without reloading an archived Client', async ({ authedPage: page }) => {
  await page.goto('/documents/archive')
  const headers = { Authorization: `Bearer ${await page.evaluate(() => sessionStorage.getItem('hf_token'))}` }
  const capability = await (await page.request.get('/documents/capabilities', { headers })).json()
  test.skip(!capability.upload_enabled, 'Private synthetic-test environment required')
  const client = (await (await page.request.get('/clients', { headers })).json())[0]
  expect((await page.request.post(`/clients/${client.id}/archive`, { headers })).ok()).toBe(true)
  await page.goto(`/clients/${client.id}`)
  const panel = page.getByRole('region', { name: 'Documents', exact: true })
  await expect(panel.getByText('No active Documents.')).toBeVisible()
  await expect(panel.getByText(/Archived client/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Upload document' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Restore client', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Upload document', exact: true })).toBeVisible()
  await expect(panel.getByText(/Archived client/)).toHaveCount(0)
})

test('Phase 3 documents archive supports direct navigation and refresh', async ({ authedPage: page }) => {
  await page.goto('/documents/archive')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Document archive', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload document' })).toHaveCount(0)
})

test('Phase 3 documents uses server upload capability and shows synthetic Client Documents', async ({ authedPage: page }) => {
  await page.goto('/today')
  const token = await page.evaluate(() => sessionStorage.getItem('hf_token'))
  const headers = { Authorization: `Bearer ${token}` }
  const clients = await (await page.request.get('/clients', { headers })).json()
  const client = clients.find((item) => item.full_name === 'Eleanor Rigby') || clients[0]
  const capability = await (await page.request.get('/documents/capabilities', { headers })).json()
  await page.goto(`/clients/${client.id}`)
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload document', exact: true })).toHaveCount(capability.upload_enabled ? 1 : 0)
  if (!capability.upload_enabled) {
    const denied = await page.request.post(`/clients/${client.id}/documents`, { headers, multipart: { file: { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') } } })
    expect(denied.status()).toBe(503)
    expect((await denied.json()).detail).toBe('Document uploads are disabled')
  }
})

async function createArchiveClient(page, { access_token }) {
  const headers = { Authorization: `Bearer ${access_token}` }
  // Configure before Today mounts, avoiding the unrelated automatic timezone PUT race (#87).
  expect((await page.request.put('/workspace/preferences', { headers, data: {
    timezone_name: 'UTC',
  } })).ok()).toBe(true)
  const created = await page.request.post('/clients', { headers, data: {
    full_name: 'Eleanor Rigby', zip_code: '10001', age: 68,
    income_level: 'medium', doctors: [], prescriptions: [], procedures: [],
  } })
  expect(created.ok()).toBe(true)
  const client = await created.json()
  return { client, headers }
}

test('archived Client Issue cannot start Appeal generation from a direct link', async ({ authedPage: page, authedSession }) => {
  const { client, headers } = await createArchiveClient(page, authedSession)
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Historical Issue' } })).json()
  expect((await page.request.post(`/clients/${client.id}/archive`, { headers })).ok()).toBe(true)
  let generations = 0
  await page.route('**/appeal', async (route) => {
    generations += 1
    await route.fulfill({ status: 503, json: { detail: 'Generation must not be called' } })
  })
  await page.goto(`/appeals?issue=${issue.id}`)
  await expect(page.getByText(/Restore the Client before drafting/)).toBeVisible()
  await expect(page.getByLabel('Existing Issue').locator(`option[value="${issue.id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Use sample' }).click()
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByRole('alert')).toContainText('Restore the Client')
  expect(generations).toBe(0)
  await page.goto('/issues')
  await page.getByRole('button', { name: /Historical Issue/ }).click()
  await expect(page.getByRole('heading', { name: 'Historical Issue', exact: true })).toBeVisible()
})

test('collapsed Appeal Documents never fetch or join global refresh until expanded', async ({ authedPage: page, authedSession }) => {
  const { client, headers } = await createArchiveClient(page, authedSession)
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Lazy Documents Issue' } })).json()
  const appeal = await (await page.request.post('/appeals', { headers, data: { issue_id: issue.id, title: 'Lazy Appeal' } })).json()
  let appealReads = 0
  page.on('request', (request) => {
    if (request.url().includes(`target_type=appeal&target_id=${appeal.id}`)) appealReads += 1
  })
  await page.goto('/issues')
  await page.getByRole('button', { name: /Lazy Documents Issue/ }).click()
  const panel = page.locator('details').filter({ hasText: 'Documents · Lazy Appeal' })
  const issueDocuments = page.locator('.phase2-detail > .document-panel')
  await expect(issueDocuments.getByText('No active Documents.')).toBeVisible()
  await expect(panel.locator('.document-panel')).toHaveCount(0)
  expect(appealReads).toBe(0)
  await panel.locator('summary').click()
  await expect(panel.getByText('No active Documents.')).toBeVisible()
  // Development StrictMode may run mount effects twice. The contract is no
  // requests while collapsed, and no further refresh requests after closing.
  const expandedReads = appealReads
  expect(expandedReads).toBeGreaterThan(0)
  await panel.locator('summary').click()
  await expect(panel.locator('.document-panel')).toHaveCount(0)
  const refreshed = page.waitForResponse((response) => response.url().includes(`target_type=issue&target_id=${issue.id}`))
  await page.evaluate(() => window.dispatchEvent(new Event('healthflow:documents-changed')))
  await refreshed
  await expect(issueDocuments.getByText('No active Documents.')).toBeVisible()
  expect(appealReads).toBe(expandedReads)
})

test('Appeal generation rechecks a Client archived after Issue selection', async ({ authedPage: page, authedSession }) => {
  const { client, headers } = await createArchiveClient(page, authedSession)
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Selected Issue' } })).json()
  let generations = 0
  await page.route('**/appeal', async (route) => {
    generations += 1
    await route.fulfill({ status: 503, json: { detail: 'Generation must not be called' } })
  })
  await page.goto(`/appeals?issue=${issue.id}`)
  await expect(page.getByLabel('Existing Issue').locator(`option[value="${issue.id}"]`)).toHaveCount(1)
  expect((await page.request.post(`/clients/${client.id}/archive`, { headers })).ok()).toBe(true)
  await page.getByRole('button', { name: 'Use sample' }).click()
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByRole('alert')).toContainText('Restore the Client')
  expect(generations).toBe(0)
})

test('archived client remains in history and can be restored to the active list', async ({ authedPage: page, authedSession }) => {
  const { client } = await createArchiveClient(page, authedSession)
  const clientRow = page.locator('[data-testid="client-row"]').filter({ hasText: client.id.slice(0, 8) })

  await page.goto(`/clients/${client.id}`)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Archive client' }).click()
  await expect(page.locator('.profile-hero .status-label')).toHaveText('Archived client')
  await page.reload()
  await expect(page.locator('.profile-hero .status-label')).toHaveText('Archived client')
  await page.getByRole('complementary').locator('a[href="/clients"]').click()
  await expect(clientRow).toHaveCount(0)
  await page.getByRole('link', { name: 'Archived clients' }).click()
  await expect(clientRow).toBeVisible()
  await page.reload()
  await expect(clientRow).toBeVisible()

  await clientRow.getByText('Eleanor Rigby', { exact: true }).click()
  await page.getByRole('button', { name: 'Restore client' }).click()
  await expect(page.locator('.profile-hero .status-label')).toHaveCount(0)
  await page.getByRole('link', { name: 'Active clients' }).click()
  await expect(clientRow).toBeVisible()
})

test('archived client keeps Today and Scheduling deadlines visible', async ({ authedPage: page, authedSession }) => {
  const { client, headers } = await createArchiveClient(page, authedSession)
  const due = new Date()
  due.setUTCHours(12, 0, 0, 0)
  const ends = new Date(due.getTime() + 1_800_000)
  expect((await page.request.post('/tasks', { headers, data: {
    title: 'Archive deadline', client_id: client.id, due_at: due.toISOString(),
  } })).ok()).toBe(true)
  expect((await page.request.post('/appointments', { headers, data: {
    title: 'Archive meeting', client_id: client.id,
    starts_at: due.toISOString(), ends_at: ends.toISOString(),
  } })).ok()).toBe(true)
  await page.goto(`/clients/${client.id}`)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Archive client' }).click()
  await expect(page.locator('.profile-hero .status-label')).toHaveText('Archived client')
  await page.getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive deadline' }).getByText('Archived client')).toBeVisible()
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive meeting' }).getByText('Archived client')).toBeVisible()
  await page.getByRole('link', { name: 'Scheduling', exact: true }).click()
  await expect(page.locator('.workspace-list-row').filter({ hasText: 'Archive meeting' }).getByText('Archived client')).toBeVisible()
})
