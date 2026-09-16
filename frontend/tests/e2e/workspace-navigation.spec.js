import { test, expect } from '../fixtures'

test('authenticated root opens Today with Broker workspace navigation', async ({ authedPage }) => {
  await authedPage.goto('/')
  await expect(authedPage).toHaveURL(/\/today$/)
  await expect(authedPage.getByRole('heading', { name: 'Today' })).toBeVisible()

  const nav = authedPage.getByRole('complementary')
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

test('Overview shows live workspace counts', async ({ authedPage }) => {
  await authedPage.goto('/overview')
  await expect(authedPage.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(authedPage.getByText('Open tasks')).toBeVisible()
  await expect(authedPage.getByText('Upcoming appointments')).toBeVisible()
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
