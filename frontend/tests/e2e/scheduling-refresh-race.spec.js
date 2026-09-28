import { test, expect } from '@playwright/test'

/** Advances a UTC calendar day without depending on the runner's local time zone. */
function dateAfter(day, count) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

test('an old action refresh cannot replace the selected Scheduling week', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10)
  const nextWeek = dateAfter(today, 7)
  await page.clock.install({ time: new Date(`${today}T12:00:00Z`) })
  const current = {
    id: 'current-meeting', title: 'Current week meeting', status: 'scheduled',
    starts_at: `${dateAfter(today, 1)}T12:00:00Z`,
    ends_at: `${dateAfter(today, 1)}T13:00:00Z`,
  }
  const upcoming = {
    id: 'next-meeting', title: 'Next week meeting', status: 'scheduled',
    starts_at: `${dateAfter(today, 8)}T12:00:00Z`,
    ends_at: `${dateAfter(today, 8)}T13:00:00Z`,
  }

  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: 'broker', role: 'broker', exp: 4102444800 }))
    sessionStorage.setItem('hf_token', `test.${payload}.signature`)
  })
  await page.route('**/workspace/preferences', (route) => route.fulfill({ json: { timezone_name: 'UTC' } }))
  await page.route(/\/clients\?linkable=true$/, (route) => route.fulfill({ json: [] }))
  await page.route(/\/organizations\?/, (route) => route.fulfill({ json: [] }))
  await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok' } }))

  let completed = false
  let signalOldRefresh
  let releaseOldRefresh
  const oldRefreshStarted = new Promise((resolve) => { signalOldRefresh = resolve })
  const oldRefreshHeld = new Promise((resolve) => { releaseOldRefresh = resolve })
  await page.route('**/appointments/current-meeting/complete', (route) => {
    completed = true
    return route.fulfill({ json: { ...current, status: 'completed' } })
  })
  await page.route(/\/appointments\?/, async (route) => {
    const selectedDay = new URL(route.request().url()).searchParams.get('ends_after').slice(0, 10)
    if (selectedDay === today && completed) {
      signalOldRefresh()
      await oldRefreshHeld
      await route.fulfill({ json: [{ ...current, status: 'completed' }] })
    } else {
      await route.fulfill({ json: selectedDay === nextWeek ? [upcoming] : [current] })
    }
  })

  await page.goto('/scheduling')
  const currentRow = page.locator('li.workspace-list-row').filter({ hasText: 'Current week meeting' })
  const upcomingRow = page.locator('li.workspace-list-row').filter({ hasText: 'Next week meeting' })
  await expect(currentRow).toBeVisible()
  await currentRow.getByRole('button', { name: 'Complete' }).click()
  await oldRefreshStarted
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(upcomingRow).toBeVisible()

  const staleResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/appointments' && url.searchParams.get('ends_after')?.startsWith(today)
  })
  releaseOldRefresh()
  await staleResponse
  await page.waitForLoadState('networkidle')
  await expect(upcomingRow).toBeVisible()
})
