import { test, expect } from '../fixtures'

// Estimate Costs and Check Network had no coverage; a removed helper once
// crashed a tool page without failing the build. These run each tool once.
//
// The tool APIs call Claude for their summary, and CI has no real Anthropic
// key, so these tests answer the API with responses shaped like the real
// models. They check that the pages render results, not the model output.

const breakdown = (care) => ({
  premium_total: 0, deductible_spent: 0, doctor_visit_costs: care * 0.4, prescription_costs: care * 0.5,
  procedure_costs: care * 0.1, total_before_oop_cap: care, oop_cap_applied: false, final_care_cost: care,
})
const costPlan = (id, name, premium, care) => ({
  plan_id: id, plan_name: name, annual_premium: premium, annual_care_cost: care,
  total_annual_cost: premium + care, breakdown: breakdown(care), prescription_details: [], procedure_details: [],
})
const CALCULATE_RESPONSE = {
  session_id: 'e2e-session',
  plans: [costPlan('H3312-034', 'Aetna Medicare Eagle Plus (HMO)', 0, 1180), costPlan('H5216-002', 'Humana Gold Plus (HMO)', 348, 1320)],
  recommendation: 'Aetna Medicare Eagle Plus has the lowest estimated yearly total.',
  disclaimer: 'Estimates only.',
}
const networkPlan = (id, name, inNetwork) => ({
  plan_id: id, plan_name: name,
  provider_results: [{ name: 'Dr. Jane Smith', npi: '1234567893', npi_verified: true, specialty: 'Internal Medicine', in_network: inNetwork, warning: null }],
  formulary_results: [],
})
const VERIFY_RESPONSE = {
  session_id: 'e2e-session',
  plans: [networkPlan('H3312-034', 'Aetna Medicare Eagle Plus (HMO)', true), networkPlan('H5216-002', 'Humana Gold Plus (HMO)', false)],
  recommendation: 'Dr. Jane Smith is listed in one of the two plans.',
  disclaimer: 'Networks change.',
}

async function answerToolApi(page, path, body) {
  await page.route((url) => url.pathname === path, (route) => (
    route.request().method() === 'POST' ? route.fulfill({ json: body }) : route.continue()
  ))
}

test('Estimate Costs ranks plans by yearly cost', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await answerToolApi(page, '/calculate', CALCULATE_RESPONSE)
  await page.goto('/calculator')
  await page.getByPlaceholder('Medication').fill('Metformin')
  await page.getByPlaceholder('Medication').press('Enter')
  await page.getByRole('button', { name: /Estimate cost/ }).click()
  const rows = page.locator('.cost-table tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Aetna Medicare Eagle Plus (HMO)')
  await expect(rows.first()).toContainText('Lowest estimate')
  await expect(page.getByText('Aetna Medicare Eagle Plus has the lowest estimated yearly total.')).toBeVisible()
  expect(errors).toEqual([])
})

test('Check Network shows each provider against every plan', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await answerToolApi(page, '/verify', VERIFY_RESPONSE)
  await page.goto('/network')
  await page.getByPlaceholder('Doctor name').fill('Dr. Jane Smith')
  await page.getByPlaceholder('Doctor name').press('Enter')
  await page.getByRole('button', { name: /Check coverage/ }).click()
  const providerRow = page.locator('.net-table tbody tr').filter({ hasText: 'Dr. Jane Smith' })
  await expect(providerRow).toBeVisible()
  await expect(providerRow.locator('td').nth(1)).toContainText('Listed in network')
  await expect(providerRow.locator('td').nth(2)).toContainText('Not listed')
  await expect(providerRow).toContainText('Verified in NPPES')
  expect(errors).toEqual([])
})

test('Explain Coverage opens with the sample Summary of Benefits', async ({ authedPage: page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/translator')
  await expect(page.getByRole('heading', { name: 'Explain coverage' })).toBeVisible()
  await expect(page.getByLabel('Summary of Benefits text')).toHaveValue(/SUMMARY OF BENEFITS/)
  await expect(page.getByRole('button', { name: 'What is the ER copay if admitted?' })).toBeEnabled()
  expect(errors).toEqual([])
})
