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
  await authedPage.goto('/enrollments')
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

test('Issue can resolve without an Appeal and Draft Appeal requires Issue context', async ({ authedPage }) => {
  await authedPage.goto('/today')
  const client = await createClient(authedPage, 'Issue Context Client')
  await authedPage.goto('/issues')
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

  await authedPage.goto('/appeals')
  await authedPage.getByRole('button', { name: 'Use sample' }).click()
  await authedPage.getByRole('button', { name: 'Analyze & draft' }).click()
  await expect(authedPage.getByRole('alert')).toContainText('Choose an existing Issue')
  const issueOption = authedPage.getByLabel('Existing Issue').getByRole('option', { name: /Issue Context Client · Incorrect specialist copay/ })
  await authedPage.getByLabel('Existing Issue').selectOption(await issueOption.getAttribute('value'))
  await expect(authedPage.getByLabel('Existing Issue')).not.toHaveValue('')
})
