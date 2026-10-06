import { test, expect } from '../fixtures'

// The Status filter is usable while the initial list is still loading. A late
// initial response must not replace a newer filter's result or clear its error;
// it previously did both, which made the filter error test flaky (OVE-156).

test('a failed Enrollment filter stays reported when the initial list arrives late', async ({ authedPage: page }) => {
  let signalInitial
  let releaseInitial
  const initialStarted = new Promise((resolve) => { signalInitial = resolve })
  const initialHeld = new Promise((resolve) => { releaseInitial = resolve })
  await page.route((url) => url.pathname === '/enrollments' && !url.searchParams.has('status'), async (route) => {
    // The page and its API share this path; hold only the API request.
    if (route.request().resourceType() === 'document') return route.continue()
    const response = await route.fetch()
    signalInitial()
    await initialHeld
    await route.fulfill({ response })
  })
  await page.route((url) => url.pathname === '/enrollments' && url.searchParams.get('status') === 'preparing',
    (route) => route.abort())

  await page.goto('/enrollments')
  await initialStarted
  await page.getByLabel('Status').selectOption('preparing')
  await expect(page.getByRole('alert')).toContainText('Enrollments could not be filtered')

  releaseInitial()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('alert')).toContainText('Enrollments could not be filtered')
  await expect(page.getByLabel('Status')).toHaveValue('preparing')
})

test('a filtered Enrollment list is not replaced by the initial list arriving late', async ({ authedPage: page, authedSession }) => {
  const headers = { Authorization: `Bearer ${authedSession.access_token}` }
  const client = (await (await page.request.get('/clients', { headers })).json())[0]
  const preparing = await (await page.request.post('/enrollments', { headers, data: { client_id: client.id, plan_name: 'Preparing Plan' } })).json()
  const ready = await (await page.request.post('/enrollments', { headers, data: { client_id: client.id, plan_name: 'Ready Plan' } })).json()
  expect((await page.request.post(`/enrollments/${ready.id}/ready-to-submit`, { headers })).ok()).toBe(true)
  expect(preparing.status).toBe('preparing')

  let signalInitial
  let releaseInitial
  const initialStarted = new Promise((resolve) => { signalInitial = resolve })
  const initialHeld = new Promise((resolve) => { releaseInitial = resolve })
  await page.route((url) => url.pathname === '/enrollments' && !url.searchParams.has('status'), async (route) => {
    // The page and its API share this path; hold only the API request.
    if (route.request().resourceType() === 'document') return route.continue()
    const response = await route.fetch()
    signalInitial()
    await initialHeld
    await route.fulfill({ response })
  })

  await page.goto('/enrollments')
  await initialStarted
  await page.getByLabel('Status').selectOption('preparing')
  await expect(page.locator('.ws-enr').filter({ hasText: 'Preparing Plan' })).toBeVisible()

  releaseInitial()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.ws-enr').filter({ hasText: 'Preparing Plan' })).toBeVisible()
  await expect(page.locator('.ws-enr').filter({ hasText: 'Ready Plan' })).toHaveCount(0)
})

test('a client list that fails during the first load is reported even after the filter changes', async ({ authedPage: page }) => {
  let signalInitial
  let releaseInitial
  const initialStarted = new Promise((resolve) => { signalInitial = resolve })
  const initialHeld = new Promise((resolve) => { releaseInitial = resolve })
  await page.route((url) => url.pathname === '/enrollments' && !url.searchParams.has('status'), async (route) => {
    if (route.request().resourceType() === 'document') return route.continue()
    const response = await route.fetch()
    signalInitial()
    await initialHeld
    await route.fulfill({ response })
  })
  await page.route((url) => url.pathname === '/clients' && url.searchParams.get('linkable') === 'true', async (route) => {
    await initialHeld
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Unavailable"}' })
  })

  await page.goto('/enrollments')
  await initialStarted
  await page.getByLabel('Status').selectOption('preparing')
  releaseInitial()
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('alert')).toContainText('Clients could not be loaded')
})

test('an action finishing after a filter change refreshes the newly selected filter', async ({ authedPage: page, authedSession }) => {
  const headers = { Authorization: `Bearer ${authedSession.access_token}` }
  const client = (await (await page.request.get('/clients', { headers })).json())[0]
  const readySoon = await (await page.request.post('/enrollments', { headers, data: { client_id: client.id, plan_name: 'Ready Soon Plan' } })).json()
  await page.request.post('/enrollments', { headers, data: { client_id: client.id, plan_name: 'Stays Preparing Plan' } })

  await page.goto('/enrollments')
  await page.getByLabel('Status').selectOption('preparing')
  const readySoonRow = page.locator('.ws-enr').filter({ hasText: 'Ready Soon Plan' })
  await expect(readySoonRow).toBeVisible()

  // Let the action reach the server but hold its reply until the filter has changed.
  let releaseAction
  const actionHeld = new Promise((resolve) => { releaseAction = resolve })
  await page.route(`**/enrollments/${readySoon.id}/ready-to-submit`, async (route) => {
    const response = await route.fetch()
    await actionHeld
    await route.fulfill({ response })
  })
  await readySoonRow.getByRole('button', { name: 'Mark ready to submit' }).click()
  await page.getByLabel('Status').selectOption('ready_to_submit')
  await expect(readySoonRow).toBeVisible()

  releaseAction()
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Status')).toHaveValue('ready_to_submit')
  await expect(readySoonRow).toBeVisible()
  await expect(page.locator('.ws-enr').filter({ hasText: 'Stays Preparing Plan' })).toHaveCount(0)
})
