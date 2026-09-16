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
