import { test, expect } from '../fixtures'

// Working With is the Broker's single Client focus (OVE-147). It lasts for the
// tab, stores only the Client id, and prefills the Tools.

const MARJORIE = {
  full_name: 'Marjorie Calloway', zip_code: '10025', age: 67, income_level: 'medium',
  doctors: [{ name: 'Dr. Ada Okafor', npi: '1234567893' }], prescriptions: ['Metformin'], procedures: ['Colonoscopy'],
}
const INES = {
  full_name: 'Inés Duarte', zip_code: '60614', age: 71, income_level: 'low',
  doctors: [{ name: 'Dr. Lena Park', npi: '1245319599' }], prescriptions: ['Eliquis'], procedures: [],
}

async function createClient(page, headers, data) {
  const response = await page.request.post('/clients', { headers, data })
  expect(response.ok()).toBe(true)
  return response.json()
}

async function setup(page, authedSession) {
  const headers = { Authorization: `Bearer ${authedSession.access_token}` }
  const marjorie = await createClient(page, headers, MARJORIE)
  const ines = await createClient(page, headers, INES)
  return { headers, marjorie, ines }
}

const workingWith = (page) => page.getByLabel('Working with')

test('choosing a Client prefills each Tool and narrows Draft Appeal to their Issues', async ({ authedPage: page, authedSession }) => {
  const { headers, marjorie, ines } = await setup(page, authedSession)
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: marjorie.id, title: 'Denied colonoscopy' } })).json()
  await page.request.post('/issues', { headers, data: { client_id: ines.id, title: 'Eliquis tier change' } })

  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)

  await page.goto('/compare')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Metformin' })).toBeVisible()

  await page.goto('/calculator')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Metformin' })).toBeVisible()

  await page.goto('/network')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Dr. Ada Okafor' })).toBeVisible()

  await page.goto('/appeals')
  await expect(page.getByText("Showing Marjorie Calloway's Issues")).toBeVisible()
  await expect(page.getByLabel('Existing Issue')).toHaveValue(issue.id)
  await expect(page.getByLabel('Existing Issue').getByRole('option', { name: /Eliquis tier change/ })).toHaveCount(0)
  await expect(page.locator('form.ap-new-issue').getByRole('combobox')).toHaveValue(marjorie.id)
})

test('the focus survives navigation and refresh, and the tab stores only the Client id', async ({ authedPage: page, authedSession }) => {
  const { marjorie } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)

  await page.getByRole('link', { name: 'Clients' }).click()
  await expect(workingWith(page)).toHaveValue(marjorie.id)
  await page.reload()
  await expect(workingWith(page)).toHaveValue(marjorie.id)

  const stored = await page.evaluate(() => JSON.stringify(sessionStorage))
  expect(stored).toContain(marjorie.id)
  expect(stored).not.toContain('Marjorie')
  expect(stored).not.toContain('10025')
})

test('archived Clients are not offered, and archiving the focused Client clears Working With', async ({ authedPage: page, authedSession }) => {
  const { headers, marjorie, ines } = await setup(page, authedSession)
  const archived = await createClient(page, headers, { ...INES, full_name: 'Archived Arturo' })
  expect((await page.request.post(`/clients/${archived.id}/archive`, { headers })).ok()).toBe(true)

  await page.goto('/today')
  await expect(workingWith(page).getByRole('option', { name: 'Archived Arturo' })).toHaveCount(0)
  await expect(workingWith(page).getByRole('option', { name: 'Inés Duarte' })).toHaveCount(1)

  await workingWith(page).selectOption(marjorie.id)
  expect((await page.request.post(`/clients/${marjorie.id}/archive`, { headers })).ok()).toBe(true)
  await page.reload()
  await expect(workingWith(page)).toHaveValue('')
  await expect(page.getByText('Marjorie Calloway was archived, so Working With was cleared.')).toBeVisible()
  expect(ines.id).toBeTruthy()
})

test('clearing keeps an open Tool’s inputs, and Tools opened afterwards start blank', async ({ authedPage: page, authedSession }) => {
  const { marjorie } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto('/calculator')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')

  await workingWith(page).selectOption('')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Metformin' })).toBeVisible()
  await expect(page.getByLabel('Prefill from client')).toHaveValue('')

  await page.goto('/network')
  await expect(page.getByLabel('ZIP code')).not.toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Dr. Ada Okafor' })).toHaveCount(0)
})

test('switching Working With re-prefills an open Tool and keeps results already shown', async ({ authedPage: page, authedSession }) => {
  const { marjorie, ines } = await setup(page, authedSession)
  await page.route((url) => url.pathname === '/calculate', (route) => (
    route.request().method() === 'POST'
      ? route.fulfill({ json: {
        session_id: 'e2e', disclaimer: 'Estimates only.', recommendation: 'Lowest estimate first.',
        plans: [{ plan_id: 'H1', plan_name: 'Sample Plan (HMO)', annual_premium: 0, annual_care_cost: 900, total_annual_cost: 900,
          breakdown: { premium_total: 0, deductible_spent: 0, doctor_visit_costs: 400, prescription_costs: 400, procedure_costs: 100,
            total_before_oop_cap: 900, oop_cap_applied: false, final_care_cost: 900 }, prescription_details: [], procedure_details: [] }],
      } })
      : route.continue()
  ))
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto('/calculator')
  await page.getByRole('button', { name: /Estimate cost/ }).click()
  await expect(page.locator('.cost-table tbody tr').first()).toContainText('Sample Plan (HMO)')

  await workingWith(page).selectOption(ines.id)
  await expect(page.getByLabel('ZIP code')).toHaveValue('60614')
  await expect(page.locator('.chip').filter({ hasText: 'Eliquis' })).toBeVisible()
  await expect(page.locator('.cost-table tbody tr').first()).toContainText('Sample Plan (HMO)')
})

test('a Tool’s own Prefill from client overrides that Tool only', async ({ authedPage: page, authedSession }) => {
  const { marjorie, ines } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto('/calculator')
  await page.getByLabel('Prefill from client').selectOption(ines.id)
  await expect(page.getByLabel('ZIP code')).toHaveValue('60614')
  await expect(workingWith(page)).toHaveValue(marjorie.id)

  await page.goto('/network')
  await expect(page.getByLabel('ZIP code')).toHaveValue('10025')
})

// Review findings on #101. These navigate inside the app (no reload), so the
// workspace keeps its Working With state the way it does for a broker.

const nav = (page) => page.getByRole('navigation', { name: 'Primary' })

test('a Tool applies the focused Client’s latest details after they are edited', async ({ authedPage: page, authedSession }) => {
  const { headers, marjorie } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  expect((await page.request.put(`/clients/${marjorie.id}`, { headers, data: { zip_code: '10027' } })).ok()).toBe(true)

  await nav(page).getByRole('link', { name: 'Estimate Costs' }).click()
  await expect(page.getByLabel('ZIP code')).toHaveValue('10027')
})

test('archiving the focused Client from their profile clears Working With at once', async ({ authedPage: page, authedSession }) => {
  const { marjorie } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto(`/clients/${marjorie.id}`)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Archive client' }).click()

  await expect(workingWith(page)).toHaveValue('')
  await expect(page.getByText('Marjorie Calloway was archived, so Working With was cleared.')).toBeVisible()
  await nav(page).getByRole('link', { name: 'Check Network' }).click()
  await expect(page.getByLabel('ZIP code')).not.toHaveValue('10025')
  await expect(page.locator('.chip').filter({ hasText: 'Dr. Ada Okafor' })).toHaveCount(0)
})

test('Compare results stay bound to the Client they were run for', async ({ authedPage: page, authedSession }) => {
  const { marjorie, ines } = await setup(page, authedSession)
  const plan = { plan_id: 'H1', plan_name: 'Sample Plan (HMO)', plan_type: 'HMO', monthly_premium: 0, annual_deductible: 0,
    out_of_pocket_max: 4000, star_rating: 4, drug_coverage: true, estimated_medication_costs: {}, estimated_procedure_costs: {} }
  await page.route((url) => url.pathname === '/compare', (route) => (
    route.request().method() === 'POST'
      ? route.fulfill({ json: { session_id: 'run-for-marjorie', plans: [plan], recommendation: 'Sample.', disclaimer: 'Sample data.' } })
      : route.continue()
  ))
  const historyPosts = []
  await page.route((url) => url.pathname === '/history', async (route) => {
    if (route.request().method() === 'POST') historyPosts.push(route.request().postDataJSON())
    await route.continue()
  })
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto('/compare')
  await page.getByRole('button', { name: 'Compare plans' }).click()
  await expect(page.locator('.eyebrow')).toContainText('Marjorie Calloway, ZIP 10025')

  await workingWith(page).selectOption(ines.id)
  await expect(page.locator('.eyebrow')).toContainText('Marjorie Calloway, ZIP 10025')
  await page.getByRole('button', { name: /Recommend|Select/ }).first().click()
  await expect.poll(() => historyPosts.filter((post) => post.action_type !== 'compare').length).toBe(1)
  const selection = historyPosts.find((post) => post.action_type !== 'compare')
  expect(selection.client_id).toBe(marjorie.id)
})

test('Draft Appeal keeps a newly created Issue selected even for another Client', async ({ authedPage: page, authedSession }) => {
  const { headers, marjorie, ines } = await setup(page, authedSession)
  await page.request.post('/issues', { headers, data: { client_id: marjorie.id, title: 'Denied colonoscopy' } })
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  await page.goto('/appeals')
  const form = page.locator('form.ap-new-issue')
  await form.getByRole('combobox').selectOption(ines.id)
  await form.getByLabel('New Issue title').fill('Eliquis tier change')
  page.once('dialog', (dialog) => dialog.accept())
  await form.getByRole('button', { name: 'Create and use Issue' }).click()

  const existing = page.getByLabel('Existing Issue')
  await expect(existing.getByRole('option', { name: /Eliquis tier change/ })).toHaveCount(1)
  await expect(existing.locator('option:checked')).toHaveText(/Eliquis tier change/)
})

test('the archive note can be dismissed', async ({ authedPage: page, authedSession }) => {
  const { headers, marjorie } = await setup(page, authedSession)
  await page.goto('/today')
  await workingWith(page).selectOption(marjorie.id)
  expect((await page.request.post(`/clients/${marjorie.id}/archive`, { headers })).ok()).toBe(true)
  await page.reload()
  const note = page.getByText('Marjorie Calloway was archived, so Working With was cleared.')
  await expect(note).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(note).toHaveCount(0)
})
