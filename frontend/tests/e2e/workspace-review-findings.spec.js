import { test, expect } from '../fixtures'

// Regressions from the PR #92 review: failed loads must not read as an
// all-clear, a stored upload must not invite a duplicate, and navigation must
// lead to pages the broker can use.

const failed = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Unavailable"}' })

async function authHeaders(page) {
  return { Authorization: `Bearer ${await page.evaluate(() => sessionStorage.getItem('hf_token'))}` }
}

async function createClient(page, headers, name) {
  const response = await page.request.post('/clients', {
    headers,
    data: { full_name: name, zip_code: '10001', age: 68, income_level: 'medium', doctors: [], prescriptions: [], procedures: [] },
  })
  expect(response.ok()).toBe(true)
  return response.json()
}

test('Waiting for you keeps loaded items and says the list is incomplete when a source fails', async ({ authedPage: page }) => {
  await page.route((url) => url.pathname === '/enrollments' && url.searchParams.get('status') === 'ready_to_submit', (route) => route.fulfill({
    json: [{ id: 'enrollment-e2e', plan_name: 'Aetna Medicare Eagle Plus (HMO)', client_name: 'Pat Example', status: 'ready_to_submit' }],
  }))
  await page.route((url) => url.pathname === '/issues' && url.searchParams.get('status') === 'in_progress', failed)
  await page.goto('/today')
  const section = page.getByRole('region', { name: 'Waiting for you' })
  await expect(section.getByText('Record Aetna Medicare Eagle Plus (HMO) enrollment as submitted')).toBeVisible()
  await expect(section.getByRole('alert')).toContainText('may be incomplete')
  await expect(section.getByText('Nothing needs your sign-off.')).toHaveCount(0)
})

test('Overview reports an appointment load failure instead of an empty week', async ({ authedPage: page }) => {
  await page.route((url) => url.pathname === '/appointments', failed)
  await page.goto('/overview')
  await expect(page.getByText('Upcoming meetings could not be loaded. Refresh to try again.')).toBeVisible()
  await expect(page.getByText('No meetings in the next week.')).toHaveCount(0)
})

test('Overview sends Open tasks to Today, where every open task is listed', async ({ authedPage: page }) => {
  await page.goto('/overview')
  await expect(page.locator('a[href="/today"]').filter({ hasText: 'Open tasks' })).toBeVisible()
  await expect(page.locator('a[href="/follow-ups"]').filter({ hasText: 'Open tasks' })).toHaveCount(0)
})

test('a Document that uploads but fails to link is kept, and the form does not invite a second upload', async ({ authedPage: page }) => {
  await page.goto('/today')
  const headers = await authHeaders(page)
  const client = await createClient(page, headers, 'Link Failure Client')
  expect((await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Denied MRI' } })).ok()).toBe(true)
  let uploads = 0
  await page.route('**/documents/capabilities', (route) => route.fulfill({ json: { upload_enabled: true } }))
  await page.route((url) => url.pathname === `/clients/${client.id}/documents`, (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    uploads += 1
    return route.fulfill({ status: 201, json: { id: 'document-e2e', client_id: client.id, display_filename: 'denial-letter.pdf' } })
  })
  await page.route('**/documents/document-e2e/links', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"That Issue is no longer open."}' }))

  await page.goto('/documents')
  const form = page.locator('form.doc-upload')
  await form.getByLabel('Client').selectOption(client.id)
  await form.getByLabel('Related record').selectOption({ label: 'Issue · Denied MRI' })
  await form.getByLabel('Document file').setInputFiles({ name: 'denial-letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
  await form.getByRole('button', { name: 'Upload document' }).click()

  await expect(page.getByRole('alert')).toContainText('denial-letter.pdf was uploaded, but it could not be linked')
  await expect(page.getByRole('alert')).toContainText('do not upload it again')
  await expect(page.getByText('No file chosen')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload document' })).toBeDisabled()
  expect(uploads).toBe(1)
})

test('an archived common carrier is not offered for one-click creation', async ({ authedPage: page }) => {
  await page.goto('/today')
  const headers = await authHeaders(page)
  const created = await page.request.post('/organizations', { headers, data: { name: 'Aetna', kind: 'carrier' } })
  expect(created.ok()).toBe(true)
  expect((await page.request.post(`/organizations/${(await created.json()).id}/archive`, { headers })).ok()).toBe(true)
  await page.goto('/organizations')
  await expect(page.getByRole('button', { name: /Humana/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Aetna/ })).toHaveCount(0)
})

test('the sidebar links to Settings and hides Team from a broker who is not an admin', async ({ authedPage: page }) => {
  await page.goto('/today')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

test.describe('Issue deadlines on a device in another time zone', () => {
  // Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so their
  // calendar dates always differ by one day, whatever time the test runs.
  test.use({ timezoneId: 'Pacific/Pago_Pago' })

  test('count days from today in the workspace time zone', async ({ authedPage: page }) => {
    await page.goto('/today')
    const headers = await authHeaders(page)
    expect((await page.request.put('/workspace/preferences', { headers, data: { timezone_name: 'Pacific/Kiritimati' } })).ok()).toBe(true)
    const workspaceToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date())
    const tomorrow = new Date(`${workspaceToday}T12:00:00Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const client = await createClient(page, headers, 'Deadline Zone Client')
    expect((await page.request.post('/issues', { headers, data: { client_id: client.id, title: 'Appeal window', deadline: tomorrow.toISOString().slice(0, 10) } })).ok()).toBe(true)
    await page.goto('/issues')
    await expect(page.getByText(/Due in 1 day ·/).first()).toBeVisible()
  })
})
