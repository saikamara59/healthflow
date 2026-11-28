import { test, expect } from '../fixtures'

// Save as Document for Draft Appeal and Explain Coverage output (OVE-191).
// Document storage is often disabled in e2e, so the capability and the save
// request are intercepted; the server side is covered by test_tool_output_save.py.

async function authHeaders(page) {
  const token = await page.evaluate(() => sessionStorage.getItem('hf_token'))
  return { Authorization: `Bearer ${token}` }
}

async function createClientWithIssue(page, name, title) {
  const headers = await authHeaders(page)
  const client = await (await page.request.post('/clients', {
    headers,
    data: { full_name: name, zip_code: '10001', age: 68, income_level: 'medium', doctors: [], prescriptions: [], procedures: [] },
  })).json()
  const issue = await (await page.request.post('/issues', { headers, data: { client_id: client.id, title } })).json()
  return { client, issue }
}

function appealResult(letter) {
  return {
    session_id: 'save-output-test',
    denial_analysis: {
      denial_reason_code: 'CO-50', denial_reason: 'Not medically necessary',
      treatment_denied: 'MRI', policy_section_cited: null,
      appeal_deadline: '60 days', denial_date: '03/28/2026',
    },
    coverage_argument: { cms_rule: 'Coverage applies when medically necessary.', common_appeal_grounds: [], success_precedents: [] },
    appeal_letter: letter,
    refined_recommendation: 'Broker review required.',
    disclaimer: 'For educational purposes only.',
  }
}

async function captureSaves(page) {
  const saves = []
  await page.route('**/documents/capabilities', (route) => route.fulfill({ json: { upload_enabled: true } }))
  await page.route('**/tool-output/documents', async (route) => {
    saves.push(route.request().postDataJSON())
    await route.fulfill({ status: 201, json: { id: '00000000-0000-0000-0000-000000000191' } })
  })
  return saves
}

test('Draft Appeal output is saved as a Document on the Issue Client only after confirmation', async ({ authedPage: page }) => {
  await page.goto('/today')
  const { client, issue } = await createClientWithIssue(page, 'Save Output Appeal Client', 'Save output case')
  const saves = await captureSaves(page)
  await page.route('**/appeal', (route) => route.fulfill({ json: appealResult('Letter for the Issue Client.') }))

  await page.goto(`/appeals?issue=${issue.id}`)
  await page.getByRole('button', { name: 'Use sample' }).click()
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByText('Letter for the Issue Client.')).toBeVisible()

  await page.getByRole('button', { name: 'Save as Document' }).click()
  const review = page.getByRole('form', { name: 'Review Document save' })
  await expect(review.getByText('Save Output Appeal Client')).toBeVisible()
  const confirm = review.getByRole('button', { name: 'Confirm and save' })
  await expect(confirm).toBeDisabled()
  expect(saves).toHaveLength(0)

  await review.getByRole('checkbox').check()
  await confirm.click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved as a protected Document' })).toBeVisible()
  expect(saves).toEqual([{ source: 'draft_appeal', client_id: client.id, text: 'Letter for the Issue Client.', confirmed: true }])
})

test('Draft Appeal stops when the Issue moved to another Client after the page loaded', async ({ authedPage: page }) => {
  await page.goto('/today')
  const { issue } = await createClientWithIssue(page, 'Original Issue Client', 'Moved Issue')
  const { client: newOwner } = await createClientWithIssue(page, 'Current Issue Client', 'Other Issue')
  const saves = await captureSaves(page)
  const letters = ['Letter drafted for the original Client.', 'Letter for the moved Issue.']
  let drafts = 0
  await page.route('**/appeal', (route) => route.fulfill({ json: appealResult(letters[drafts++]) }))

  await page.goto(`/appeals?issue=${issue.id}`)
  await expect(page.getByLabel('Existing Issue')).toHaveValue(issue.id)
  await page.getByRole('button', { name: 'Use sample' }).click()
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByText(letters[0])).toBeVisible()

  // Another tab moves the Issue to a different Client after this page loaded its Issues.
  const moved = await page.request.put(`/issues/${issue.id}`, { headers: await authHeaders(page), data: { client_id: newOwner.id } })
  expect(moved.ok()).toBe(true)

  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByRole('alert')).toContainText('This Issue now belongs to Current Issue Client')
  expect(drafts).toBe(1)
  // The earlier letter does not reappear under the Issue's new Client.
  await expect(page.getByText(letters[0])).toHaveCount(0)

  // With the refreshed Issue, drafting again uses its current Client.
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(page.getByText('Letter for the moved Issue.')).toBeVisible()
  await page.getByRole('button', { name: 'Save as Document' }).click()
  const review = page.getByRole('form', { name: 'Review Document save' })
  await expect(review.getByText('Current Issue Client')).toBeVisible()
  await review.getByRole('checkbox').check()
  await review.getByRole('button', { name: 'Confirm and save' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Saved as a protected Document' })).toBeVisible()
  expect(saves.map((save) => save.client_id)).toEqual([newOwner.id])
})

test('A late Appeal letter is discarded after the Broker switches Issue', async ({ authedPage: page }) => {
  await page.goto('/today')
  const first = await createClientWithIssue(page, 'Late Letter Client A', 'Issue A')
  const second = await createClientWithIssue(page, 'Late Letter Client B', 'Issue B')
  await captureSaves(page)
  let release
  const held = new Promise((resolve) => { release = resolve })
  let started
  const requested = new Promise((resolve) => { started = resolve })
  await page.route('**/appeal', async (route) => {
    started()
    await held
    await route.fulfill({ json: appealResult('Letter generated for Client A.') })
  })

  await page.goto(`/appeals?issue=${first.issue.id}`)
  await page.getByRole('button', { name: 'Use sample' }).click()
  await page.getByRole('button', { name: 'Analyze & draft' }).click()
  await requested
  await page.getByLabel('Existing Issue').selectOption(second.issue.id)
  const response = page.waitForResponse((r) => r.url().endsWith('/appeal'))
  release()
  await response
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await expect(page.getByText('Letter generated for Client A.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save as Document' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Analyze & draft' })).toBeEnabled()
})

test('Explain Coverage saves the latest answer to a Client the Broker chooses', async ({ authedPage: page }) => {
  await page.goto('/today')
  const { client } = await createClientWithIssue(page, 'Save Output Coverage Client', 'Coverage question')
  const saves = await captureSaves(page)
  await page.route('**/translate', (route) => route.fulfill({ json: { answer: 'The ER copay is waived if admitted.', relevant_sections: ['Emergency Room'] } }))

  await page.goto('/translator')
  await page.getByRole('button', { name: 'What is the ER copay if admitted?' }).click()
  await expect(page.getByText('The ER copay is waived if admitted.')).toBeVisible()

  await page.getByRole('button', { name: 'Save latest answer as Document' }).click()
  const review = page.getByRole('form', { name: 'Review Document save' })
  await review.getByLabel('Related Client').selectOption(client.id)
  await review.getByRole('checkbox').check()
  await review.getByRole('button', { name: 'Confirm and save' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Saved as a protected Document' })).toBeVisible()
  expect(saves).toEqual([{
    source: 'explain_coverage',
    client_id: client.id,
    text: 'Question: What is the ER copay if admitted?\n\nAnswer: The ER copay is waived if admitted.',
    confirmed: true,
  }])
})

test('Save as Document offers only Clients the Broker can link', async ({ authedPage: page }) => {
  await page.goto('/today')
  const { client } = await createClientWithIssue(page, 'Linkable Coverage Client', 'Linkable case')
  await captureSaves(page)
  await page.route('**/clients*', (route) => {
    if (route.request().isNavigationRequest()) return route.continue()
    const linkable = new URL(route.request().url()).searchParams.get('linkable') === 'true'
    const foreign = { ...client, id: '00000000-0000-0000-0000-000000000073', full_name: 'Other broker client' }
    return route.fulfill({ json: linkable ? [client] : [foreign, client] })
  })
  await page.route('**/translate', (route) => route.fulfill({ json: { answer: 'Specialists need a referral.', relevant_sections: [] } }))

  await page.goto('/translator')
  await page.getByRole('button', { name: 'Does specialist care need a referral?' }).click()
  await page.getByRole('button', { name: 'Save latest answer as Document' }).click()

  const selector = page.getByRole('form', { name: 'Review Document save' }).getByLabel('Related Client')
  await expect(selector.getByRole('option', { name: 'Linkable Coverage Client' })).toHaveCount(1)
  await expect(selector.getByRole('option', { name: 'Other broker client' })).toHaveCount(0)
})
