import { useEffect, useState } from 'react'
import { workspaceApi } from '../../api/workspace'

// Organization name -> website, shared by every logo on the page. Loaded once
// and reused for a minute so a list of 30 tasks makes one request, not 30.
const TTL_MS = 60_000
let cache = null

function loadWebsites() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise
  const promise = workspaceApi.listOrganizations(false, true)
    .then((rows) => Object.fromEntries((rows || []).filter((row) => row.website).map((row) => [row.name.trim().toLowerCase(), row.website])))
    .catch(() => ({}))
  cache = { at: Date.now(), promise }
  return promise
}

export function forgetOrganizationWebsites() { cache = null }

export default function useOrganizationWebsites() {
  const [websites, setWebsites] = useState({})
  useEffect(() => {
    let alive = true
    loadWebsites().then((map) => { if (alive) setWebsites(map) })
    return () => { alive = false }
  }, [])
  return websites
}
