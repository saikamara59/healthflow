import { test, expect } from '../fixtures'

test('Follow-ups keeps a saved Task when the initial list arrives late', async ({ authedPage: page }) => {
  let saving = false
  let signalInitial
  let releaseInitial
  const initialStarted = new Promise((resolve) => { signalInitial = resolve })
  const initialHeld = new Promise((resolve) => { releaseInitial = resolve })
  await page.route(/\/tasks\?is_follow_up=true&status=open&/, async (route) => {
    if (saving) return route.continue()
    // Capture the real empty initial list, then deliver it after the real save.
    const response = await route.fetch()
    signalInitial()
    await initialHeld
    await route.fulfill({ response })
  })

  await page.goto('/follow-ups')
  await initialStarted
  await page.getByRole('button', { name: 'New Follow-up' }).click()
  await page.getByLabel('Task title').fill('Retain saved follow-up')
  saving = true
  await page.getByRole('button', { name: 'Create Task', exact: true }).click()
  const savedTask = page.getByRole('listitem', { name: 'Retain saved follow-up' })
  await expect(savedTask).toBeVisible()

  releaseInitial()
  await page.waitForLoadState('networkidle')
  await expect(savedTask).toBeVisible()
})
