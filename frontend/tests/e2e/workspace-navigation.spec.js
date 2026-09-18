import { test, expect } from '../fixtures'

test('authenticated root opens Today with Broker workspace navigation', async ({ authedPage }) => {
  await authedPage.goto('/')
  await expect(authedPage).toHaveURL(/\/today$/)
  await expect(authedPage.getByRole('heading', { name: 'Today' })).toBeVisible()

  const nav = authedPage.locator('.side')
  await expect(nav.getByText('Daily', { exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible()
  await expect(nav.getByText('Workspace', { exact: true })).toBeVisible()
  await expect(nav.getByText('AI Tools', { exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Compare Plans' })).toBeVisible()
  await expect(nav.getByText('Agents', { exact: true })).toHaveCount(0)
})

test('/dashboard redirects to Overview', async ({ authedPage }) => {
  await authedPage.goto('/dashboard')
  await expect(authedPage).toHaveURL(/\/overview$/)
})

test('broker creates an organization and contact', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  await authedPage.getByRole('button', { name: 'New Organization' }).click()
  await authedPage.getByLabel('Organization name').fill('Harbor Health')
  await authedPage.getByLabel('Kind').selectOption('provider_office')
  await authedPage.getByRole('button', { name: 'Create Organization' }).click()
  await authedPage.getByRole('link', { name: 'Harbor Health' }).click()
  await authedPage.getByRole('button', { name: 'New Contact' }).click()
  await authedPage.getByLabel('Contact name').fill('Dana Ruiz')
  await authedPage.getByRole('button', { name: 'Create Contact' }).click()
  await expect(authedPage.getByText('Dana Ruiz')).toBeVisible()
})

test('repeated Contact form submits create only one record', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  await authedPage.getByRole('button', { name: 'New Organization' }).click()
  await authedPage.getByLabel('Organization name').fill('Single Contact Harbor')
  await authedPage.getByRole('button', { name: 'Create Organization' }).click()
  await authedPage.getByRole('link', { name: 'Single Contact Harbor' }).click()
  await authedPage.getByRole('button', { name: 'New Contact' }).click()
  await authedPage.getByLabel('Contact name').fill('Dana Ruiz')
  await authedPage.locator('.workspace-inline-form').evaluate((form) => {
    form.requestSubmit()
    form.requestSubmit()
  })
  await expect(authedPage.getByText('Dana Ruiz')).toBeVisible()
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const response = await authedPage.request.get(`/organizations/${authedPage.url().split('/').pop()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBe(true)
  expect((await response.json()).contacts.filter((item) => item.full_name === 'Dana Ruiz')).toHaveLength(1)
})

test('a Contact save refresh cannot replace a different Organization route', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const headers = { Authorization: `Bearer ${token}` }
  const first = await authedPage.request.post('/organizations', { headers, data: { name: 'First Harbor', kind: 'provider_office' } })
  const second = await authedPage.request.post('/organizations', { headers, data: { name: 'Second Harbor', kind: 'provider_office' } })
  expect(first.ok()).toBe(true)
  expect(second.ok()).toBe(true)
  const firstId = (await first.json()).id
  await authedPage.goto(`/organizations/${firstId}`)
  await expect(authedPage.getByRole('heading', { name: 'First Harbor' })).toBeVisible()
  let signalRefresh
  let releaseRefresh
  const refreshStarted = new Promise((resolve) => { signalRefresh = resolve })
  const heldRefresh = new Promise((resolve) => { releaseRefresh = resolve })
  await authedPage.route(`**/organizations/${firstId}`, async (route) => {
    signalRefresh()
    await heldRefresh
    await route.continue()
  })
  await authedPage.getByRole('button', { name: 'New Contact' }).click()
  await authedPage.getByLabel('Contact name').fill('Dana Ruiz')
  await authedPage.getByRole('button', { name: 'Create Contact' }).click()
  await refreshStarted
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Second Harbor')
  await authedPage.getByRole('option', { name: /Second Harbor/i }).click()
  await expect(authedPage.getByRole('heading', { name: 'Second Harbor' })).toBeVisible()
  const staleResponse = authedPage.waitForResponse((response) => response.url().endsWith(`/organizations/${firstId}`) && response.ok())
  releaseRefresh()
  await staleResponse
  await expect(authedPage.getByRole('heading', { name: 'Second Harbor' })).toBeVisible()
  await expect(authedPage.getByRole('heading', { name: 'First Harbor' })).toHaveCount(0)
})

test('archived organizations can be restored from the directory', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  await authedPage.getByRole('button', { name: 'New Organization' }).click()
  await authedPage.getByLabel('Organization name').fill('Restore Harbor')
  await authedPage.getByRole('button', { name: 'Create Organization' }).click()
  authedPage.once('dialog', (dialog) => dialog.accept())
  await authedPage.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(authedPage.getByRole('link', { name: 'Restore Harbor' })).toHaveCount(0)
  await authedPage.getByRole('button', { name: 'Show archived' }).click()
  await expect(authedPage.getByRole('link', { name: 'Restore Harbor' })).toBeVisible()
  await authedPage.getByRole('button', { name: 'Restore' }).click()
  await expect(authedPage.getByRole('link', { name: 'Restore Harbor' })).toHaveCount(0)
  await authedPage.getByRole('button', { name: 'Show active' }).click()
  await expect(authedPage.getByRole('link', { name: 'Restore Harbor' })).toBeVisible()
})

test('a failed Organization list refresh does not report a failed save', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  await expect(authedPage.getByLabel('Filter Organizations')).toBeVisible()
  await authedPage.route('**/organizations?include_contacts=false&include_archived=false', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Unavailable"}' }))
  await authedPage.getByRole('button', { name: 'New Organization' }).click()
  await authedPage.getByLabel('Organization name').fill('Saved Harbor')
  await authedPage.getByRole('button', { name: 'Create Organization' }).click()
  await expect(authedPage.getByRole('alert')).toContainText('Organization saved, but the list could not refresh')
  await expect(authedPage.getByRole('button', { name: 'Create Organization' })).toHaveCount(0)
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const response = await authedPage.request.get('/organizations', { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok()).toBe(true)
  expect((await response.json()).filter((item) => item.name === 'Saved Harbor')).toHaveLength(1)
})

test('broker creates a follow-up', async ({ authedPage }) => {
  await authedPage.goto('/follow-ups')
  await authedPage.getByRole('button', { name: 'New Follow-up' }).click()
  await authedPage.getByLabel('Task title').fill('Call carrier about renewal')
  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  await expect(authedPage.getByText('Call carrier about renewal')).toBeVisible()
})

test('broker creates an appointment in Scheduling', async ({ authedPage }) => {
  await authedPage.goto('/scheduling')
  await authedPage.getByRole('button', { name: 'New Appointment' }).click()
  await authedPage.getByLabel('Appointment title').fill('Harbor review')
  await authedPage.getByRole('button', { name: 'Create Appointment' }).click()
  await expect(authedPage.getByText('Harbor review')).toBeVisible()
})

test('keyboard search finds a Broker task', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Review Harbor renewal')
  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  await authedPage.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Harbor')
  await expect(authedPage.getByRole('option', { name: /Review Harbor renewal/i })).toBeVisible()
  await authedPage.keyboard.press('Escape')
  await expect(authedPage.getByRole('searchbox', { name: 'Search workspace' })).toHaveCount(0)
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Harbor')
  await authedPage.getByRole('option', { name: /Review Harbor renewal/i }).click()
  await expect(authedPage).toHaveURL(/\/today\?task=/)
  await expect(authedPage.getByRole('listitem', { name: 'Review Harbor renewal' })).toBeFocused()
})

test('search reveals a completed task outside the Today sections', async ({ authedPage }) => {
  await authedPage.goto('/organizations')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const headers = { Authorization: `Bearer ${token}` }
  const created = await authedPage.request.post('/tasks', { headers, data: { title: 'Review archived renewal' } })
  expect(created.ok()).toBe(true)
  const taskId = (await created.json()).id
  await authedPage.goto('/today')
  await expect(authedPage.getByRole('heading', { name: 'Other open tasks' }).locator('..').locator('..').getByRole('listitem', { name: 'Review archived renewal' })).toBeVisible()
  expect((await authedPage.request.post(`/tasks/${taskId}/complete`, { headers })).ok()).toBe(true)
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('archived renewal')
  await authedPage.getByRole('option', { name: /Review archived renewal/i }).click()
  await expect(authedPage).toHaveURL(new RegExp(`task=${taskId}`))
  await expect(authedPage.getByRole('heading', { name: 'Search result' })).toBeVisible()
  await expect(authedPage.getByRole('listitem', { name: 'Review archived renewal' })).toBeVisible()
})

test('search reveals an appointment outside the selected week', async ({ authedPage }) => {
  await authedPage.goto('/scheduling')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const headers = { Authorization: `Bearer ${token}` }
  const created = await authedPage.request.post('/appointments', { headers, data: {
    title: 'Far future Harbor review', starts_at: '2030-01-15T10:00:00Z', ends_at: '2030-01-15T11:00:00Z',
  } })
  expect(created.ok()).toBe(true)
  const appointmentId = (await created.json()).id
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Far future Harbor')
  await authedPage.getByRole('option', { name: /Far future Harbor review/i }).click()
  await expect(authedPage).toHaveURL(new RegExp(`appointment=${appointmentId}`))
  await expect(authedPage.getByRole('heading', { name: 'Search result' })).toBeVisible()
  await expect(authedPage.getByText('Far future Harbor review')).toBeVisible()
})

test('changing a Today search target clears only its lookup error', async ({ authedPage }) => {
  await authedPage.goto('/today?task=00000000-0000-0000-0000-000000000000')
  await expect(authedPage.getByRole('alert')).toContainText('matching Task could not be loaded')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const created = await authedPage.request.post('/tasks', { headers: { Authorization: `Bearer ${token}` }, data: { title: 'Valid target task' } })
  expect(created.ok()).toBe(true)
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Valid target task')
  await authedPage.getByRole('option', { name: /Valid target task/i }).click()
  await expect(authedPage.getByRole('alert')).toHaveCount(0)
  await expect(authedPage.getByRole('listitem', { name: 'Valid target task' })).toBeVisible()
})

test('changing a Scheduling search target clears only its lookup error', async ({ authedPage }) => {
  await authedPage.goto('/scheduling?appointment=00000000-0000-0000-0000-000000000000')
  await expect(authedPage.getByRole('alert')).toContainText('matching Appointment could not be loaded')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const created = await authedPage.request.post('/appointments', { headers: { Authorization: `Bearer ${token}` }, data: {
    title: 'Valid target meeting', starts_at: '2030-01-15T10:00:00Z', ends_at: '2030-01-15T11:00:00Z',
  } })
  expect(created.ok()).toBe(true)
  await authedPage.getByRole('button', { name: 'Search workspace' }).click()
  await authedPage.getByRole('searchbox', { name: 'Search workspace' }).fill('Valid target meeting')
  await authedPage.getByRole('option', { name: /Valid target meeting/i }).click()
  await expect(authedPage.getByRole('alert')).toHaveCount(0)
  await expect(authedPage.getByText('Valid target meeting')).toBeVisible()
})

test('Overview shows live workspace counts', async ({ authedPage }) => {
  await authedPage.goto('/overview')
  await expect(authedPage.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(authedPage.getByText('Open tasks')).toBeVisible()
  await expect(authedPage.getByText('Upcoming appointments')).toBeVisible()
})

test('Overview keeps workspace data when tool history fails', async ({ authedPage }) => {
  await authedPage.route('**/history?limit=8', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await authedPage.goto('/overview')
  await expect(authedPage.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(authedPage.getByText('Open tasks')).toBeVisible()
  await expect(authedPage.getByRole('alert')).toContainText('Tool activity could not be loaded')
})

test('Activity includes completed workspace tasks', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: 'New Task' }).click()
  await authedPage.getByLabel('Task title').fill('Send renewal packet')
  await authedPage.getByRole('button', { name: 'Create Task', exact: true }).click()
  await authedPage.getByRole('listitem', { name: 'Send renewal packet' }).getByRole('checkbox').click()
  await authedPage.goto('/overview')
  await expect(authedPage.getByText('Completed Send renewal packet')).toBeVisible()
  await authedPage.getByRole('link', { name: 'View activity' }).click()
  await expect(authedPage.getByText('Completed Send renewal packet')).toBeVisible()
})

test('Activity reports a partial source failure without hiding available entries', async ({ authedPage }) => {
  await authedPage.route('**/history?limit=200', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await authedPage.route('**/workspace/activity?limit=200', (route) => route.fulfill({ json: [{
    id: 'sample-entry', action: 'completed', summary: 'Completed available work', created_at: new Date().toISOString(),
  }] }))
  await authedPage.goto('/activity')
  await expect(authedPage.getByRole('alert')).toContainText('timeline may be incomplete')
  await expect(authedPage.getByText('Completed available work')).toBeVisible()
})

test('Activity reports a load error when both sources fail', async ({ authedPage }) => {
  await authedPage.route('**/history?limit=200', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await authedPage.route('**/workspace/activity?limit=200', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await authedPage.goto('/activity')
  await expect(authedPage.getByRole('alert')).toContainText('Activity could not be loaded')
  await expect(authedPage.getByText('Nothing logged yet')).toHaveCount(0)
})

test('Broker can change the workspace time zone in Settings', async ({ authedPage }) => {
  await authedPage.goto('/settings')
  await authedPage.getByLabel('IANA time zone').selectOption('America/Chicago')
  await authedPage.getByRole('button', { name: 'Save time zone' }).click()
  await expect(authedPage.getByText('Time zone saved')).toBeVisible()
  await authedPage.reload()
  await expect(authedPage.getByLabel('IANA time zone')).toHaveValue('America/Chicago')
})

test('Appointment entry uses the saved workspace time zone', async ({ authedPage }) => {
  await authedPage.goto('/settings')
  await authedPage.getByLabel('IANA time zone').selectOption('America/Chicago')
  await authedPage.getByRole('button', { name: 'Save time zone' }).click()
  await expect(authedPage.getByText('Time zone saved')).toBeVisible()
  await authedPage.goto('/scheduling')
  await authedPage.getByRole('button', { name: 'New Appointment' }).click()
  await expect(authedPage.getByText('Times use America/Chicago.')).toBeVisible()
  await authedPage.getByLabel('Appointment title').fill('Zone conversion check')
  await authedPage.getByLabel('Start date').fill('2030-01-15')
  await authedPage.getByLabel('Start time').fill('09:00')
  await authedPage.getByLabel('End date').fill('2030-01-15')
  await authedPage.getByLabel('End time').fill('09:30')
  await authedPage.getByRole('button', { name: 'Create Appointment', exact: true }).click()
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const response = await authedPage.request.get('/appointments', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  expect(response.ok()).toBe(true)
  const saved = (await response.json()).find((item) => item.title === 'Zone conversion check')
  expect(new Date(saved.starts_at).toISOString()).toBe('2030-01-15T15:00:00.000Z')
})
