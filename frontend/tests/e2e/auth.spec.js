import { test, expect } from '../fixtures'

test('broker can log in and reach Today', async ({ page, workerBroker }) => {
  await page.goto('/login')
  await page.getByLabel(/work email/i).fill(workerBroker.email)
  await page.locator('#password').fill(workerBroker.password)
  // Scope the click to the form: the v2 glass login also has a "Sign in" tab
  // in the sign in / sign up toggle (rendered outside the form), so a
  // page-level getByRole would match two buttons. Today is the
  // workspace home now that / serves the public landing page when logged out.
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Today', level: 1, exact: true })).toBeVisible()
})

test('invalid credentials show an error', async ({ page, workerBroker }) => {
  await page.goto('/login')
  await page.getByLabel(/work email/i).fill(workerBroker.email)
  await page.locator('#password').fill('wrong-password')
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click()
  // Backend returns "Invalid email or password" for a bad password; the
  // login form surfaces whichever message the api client passes through.
  await expect(page.getByText(/invalid|incorrect|session/i)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('logged-in broker can sign out', async ({ authedPage }) => {
  await authedPage.goto('/today')
  await authedPage.getByRole('button', { name: /sign out/i }).click()
  await expect(authedPage).toHaveURL(/\/login/)
})
