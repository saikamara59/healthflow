import { test, expect } from '../fixtures'

async function createClient(page, name) {
  const token = await page.evaluate(() => sessionStorage.getItem('hf_token'))
  const response = await page.request.post('/clients', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      full_name: name,
      zip_code: '10001',
      age: 68,
      income_level: 'medium',
      doctors: [],
      prescriptions: [],
      procedures: [],
    },
  })
  expect(response.ok()).toBe(true)
  return response.json()
}

test('Broker reviews an Enrollment before confirming an external submission', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Enrollment Review Client')
  await authedPage.getByRole('link', { name: 'Enrollments' }).click()
  await authedPage.getByLabel('Client').selectOption(client.id)
  await authedPage.getByLabel('Plan name').fill('Harbor Gold PPO')
  await authedPage.getByRole('button', { name: 'Create Enrollment' }).click()
  await expect(authedPage.getByText('Enrollment Review Client · Harbor Gold PPO')).toBeVisible()
  const enrollmentRow = authedPage.locator('.workspace-list-row').filter({ hasText: 'Enrollment Review Client · Harbor Gold PPO' })

  await authedPage.getByRole('button', { name: 'Ready to submit' }).click()
  await expect(enrollmentRow.locator('small')).toContainText('Ready to submit')

  authedPage.once('dialog', (dialog) => dialog.dismiss())
  await authedPage.getByRole('button', { name: 'Mark Submitted' }).click()
  await expect(enrollmentRow.locator('small')).toContainText('Ready to submit')

  authedPage.once('dialog', (dialog) => dialog.accept())
  await authedPage.getByRole('button', { name: 'Mark Submitted' }).click()
  await expect(enrollmentRow.locator('small')).toContainText('Submitted')
})

test('Enrollment filters clear a stale load error after a successful retry', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('link', { name: 'Enrollments' }).click()
  await authedPage.route('**/enrollments?status=preparing', async (route) => {
    await route.abort()
    await authedPage.unroute('**/enrollments?status=preparing')
  })

  await authedPage.getByLabel('Status').selectOption('preparing')
  await expect(authedPage.getByRole('alert')).toContainText('Enrollments could not be filtered')
  await authedPage.getByLabel('Status').selectOption('')

  await expect(authedPage.getByRole('alert')).toHaveCount(0)
})

test('Issue can resolve without an Appeal and Draft Appeal requires Issue context', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Issue Context Client')
  await authedPage.getByRole('link', { name: 'Issues & Appeals' }).click()
  await authedPage.getByLabel('Client').selectOption(client.id)
  await authedPage.getByLabel('Issue title').fill('Incorrect specialist copay')
  await authedPage.getByRole('button', { name: 'Create Issue' }).click()
  await expect(authedPage.getByRole('heading', { name: 'Incorrect specialist copay' })).toBeVisible()
  await authedPage.getByRole('button', { name: 'Add Follow-up' }).click()
  await authedPage.getByLabel('Task title').fill('Call the carrier')
  await authedPage.getByRole('button', { name: 'Create Task' }).click()
  await expect(authedPage.getByText('Call the carrier')).toBeVisible()
  await authedPage.getByRole('button', { name: 'Add Appointment' }).click()
  await authedPage.getByLabel('Appointment title').fill('Review the carrier response')
  await authedPage.getByRole('button', { name: 'Create Appointment' }).click()
  await expect(authedPage.getByText('Review the carrier response')).toBeVisible()
  await authedPage.getByLabel('Status').selectOption('resolved')
  await expect(authedPage.getByText('No Appeal is required unless the case needs a formal challenge.')).toBeVisible()

  await authedPage.getByRole('link', { name: 'Draft Appeal' }).first().click()
  await authedPage.getByRole('button', { name: 'Use sample' }).click()
  await authedPage.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(authedPage.getByRole('alert')).toContainText('Choose an existing Issue')
  const issueOption = authedPage.getByLabel('Existing Issue').getByRole('option', { name: /Issue Context Client · Incorrect specialist copay/ })
  await authedPage.getByLabel('Existing Issue').selectOption(await issueOption.getAttribute('value'))
  await expect(authedPage.getByLabel('Existing Issue')).not.toHaveValue('')
})

test('Issue details recover from an error, use workspace time, and reopen a saved Appeal draft', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Review Finding Client')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  await authedPage.request.put('/workspace/preferences', {
    headers: { Authorization: `Bearer ${token}` },
    data: { timezone_name: 'America/New_York' },
  })
  const issueResponse = await authedPage.request.post('/issues', {
    headers: { Authorization: `Bearer ${token}` },
    data: { client_id: client.id, title: 'Reopen this appeal' },
  })
  const issue = await issueResponse.json()
  await authedPage.request.post('/appointments', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      client_id: client.id,
      issue_id: issue.id,
      title: 'Workspace-time meeting',
      starts_at: '2030-01-15T15:00:00Z',
      ends_at: '2030-01-15T15:30:00Z',
    },
  })
  await authedPage.request.post('/appeals', {
    headers: { Authorization: `Bearer ${token}` },
    data: { issue_id: issue.id, title: 'Saved draft', draft_text: 'Persisted broker appeal text.' },
  })

  await authedPage.getByRole('link', { name: 'Issues & Appeals' }).click()
  await authedPage.route(`**/issues/${issue.id}`, async (route) => {
    await route.abort()
    await authedPage.unroute(`**/issues/${issue.id}`)
  })
  await authedPage.getByRole('button', { name: /Reopen this appeal/ }).click()
  await expect(authedPage.getByRole('alert')).toContainText('Issue could not be opened')
  await authedPage.getByRole('button', { name: /Reopen this appeal/ }).click()

  await expect(authedPage.getByRole('alert')).toHaveCount(0)
  await expect(authedPage.getByText('Jan 15, 2030, 10:00 AM')).toBeVisible()
  await authedPage.getByText('Saved draft').click()
  await expect(authedPage.getByText('Persisted broker appeal text.')).toBeVisible()
})

test('Appeal drafting keeps generated requests within schema limits', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Appeal Boundary Client')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const longTitle = 'I'.repeat(300)
  const issueResponse = await authedPage.request.post('/issues', {
    headers: { Authorization: `Bearer ${token}` },
    data: { client_id: client.id, title: longTitle },
  })
  const issue = await issueResponse.json()
  let generatedRequest
  await authedPage.route('**/appeal', async (route) => {
    generatedRequest = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'review-boundary-test',
        denial_analysis: {
          denial_reason_code: 'CO-50', denial_reason: 'Not medically necessary',
          treatment_denied: 'MRI', policy_section_cited: null,
          appeal_deadline: '60 days', denial_date: '03/28/2026',
        },
        coverage_argument: {
          cms_rule: 'Coverage applies when medically necessary.',
          common_appeal_grounds: ['Provide documentation'], success_precedents: [],
        },
        appeal_letter: 'Persisted generated appeal letter.',
        refined_recommendation: 'Broker review required.',
        disclaimer: 'For educational purposes only.',
      }),
    })
  })

  await authedPage.getByRole('link', { name: 'Draft Appeal' }).first().click()
  await authedPage.getByLabel('Existing Issue').selectOption(issue.id)
  await authedPage.getByRole('button', { name: 'Use sample' }).click()
  await authedPage.getByPlaceholder(/Add referring physician notes/).fill('C'.repeat(1000))
  await authedPage.getByRole('button', { name: 'Analyze & draft' }).click()

  await expect(authedPage.getByRole('heading', { name: 'Drafted appeal letter' })).toBeVisible()
  expect(generatedRequest.additional_context.length).toBeLessThanOrEqual(1000)
  const appeals = await authedPage.request.get(`/appeals?issue_id=${issue.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const saved = await appeals.json()
  expect(saved).toHaveLength(1)
  expect(saved[0].title.length).toBeLessThanOrEqual(300)
})

test('A generated Appeal remains visible when saving the draft fails', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Appeal Save Failure Client')
  const token = await authedPage.evaluate(() => sessionStorage.getItem('hf_token'))
  const issueResponse = await authedPage.request.post('/issues', {
    headers: { Authorization: `Bearer ${token}` },
    data: { client_id: client.id, title: 'Save failure case' },
  })
  const issue = await issueResponse.json()
  await authedPage.route('**/appeal', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      session_id: 'save-failure-test',
      denial_analysis: {
        denial_reason_code: 'CO-50', denial_reason: 'Not medically necessary',
        treatment_denied: 'MRI', policy_section_cited: null,
        appeal_deadline: '60 days', denial_date: '03/28/2026',
      },
      coverage_argument: {
        cms_rule: 'Coverage applies when medically necessary.',
        common_appeal_grounds: [], success_precedents: [],
      },
      appeal_letter: 'Generated letter remains available for Broker review.',
      refined_recommendation: 'Broker review required.',
      disclaimer: 'For educational purposes only.',
    }),
  }))
  await authedPage.route('**/appeals', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: '{"detail":"Unavailable"}',
  }))

  await authedPage.getByRole('link', { name: 'Draft Appeal' }).first().click()
  await authedPage.getByLabel('Existing Issue').selectOption(issue.id)
  await authedPage.getByRole('button', { name: 'Use sample' }).click()
  await authedPage.getByRole('button', { name: 'Analyze & draft' }).click()

  await expect(authedPage.getByRole('heading', { name: 'Drafted appeal letter' })).toBeVisible()
  await expect(authedPage.getByText('Generated letter remains available for Broker review.')).toBeVisible()
  await expect(authedPage.getByRole('alert')).toContainText('generated, but the draft could not be saved')
})
