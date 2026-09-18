/** Calendar dates are entered in the Broker's saved IANA zone, not the device zone. */
export function dateInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addCalendarDays(date, count) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10)
}

function wallParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value)
  return Object.fromEntries(parts.filter((part) => ['year', 'month', 'day', 'hour', 'minute'].includes(part.type)).map((part) => [part.type, Number(part.value)]))
}

export function localToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isInteger)) throw new Error('Enter a valid date and time.')
  const wanted = Date.UTC(year, month - 1, day, hour, minute)
  let instant = wanted
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = wallParts(new Date(instant), timeZone)
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    if (shown === wanted) break
    instant += wanted - shown
  }
  const candidate = new Date(instant)
  const parts = wallParts(candidate, timeZone)
  if (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) !== wanted) {
    throw new Error('That local time does not exist in the selected time zone. Choose another time.')
  }
  // During the fall DST overlap, choose the earlier occurrence consistently.
  for (const minutes of [120, 90, 60, 30]) {
    const earlier = new Date(instant - minutes * 60_000)
    const earlierParts = wallParts(earlier, timeZone)
    if (Date.UTC(earlierParts.year, earlierParts.month - 1, earlierParts.day, earlierParts.hour, earlierParts.minute) === wanted) return earlier.toISOString()
  }
  return candidate.toISOString()
}
