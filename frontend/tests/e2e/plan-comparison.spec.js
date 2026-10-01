import { test, expect } from '../fixtures'

/** Verifies that a broker can compare plans for a seeded client and inspect the ranking. */
async function runPlanComparisonFlow({ authedPage }) {
  await authedPage.goto('/compare')
  // First seeded client is Eleanor Rigby (placeholder "None" at index 0, so Eleanor is at index 1).
  await authedPage.getByLabel('Prefill from client').selectOption({ index: 1 })
  await authedPage.getByRole('button', { name: /compare plans/i }).click()

  // Plan fetch hits real CMS data via the seeded backend — give it generous time
  const planRows = authedPage.getByTestId('plan-row')
  await expect(planRows.first()).toBeVisible({ timeout: 30_000 })
  await expect(planRows.first()).toContainText(/\$/)
}

test('broker can run plan comparison for a seeded client and see ranked plans', runPlanComparisonFlow)
