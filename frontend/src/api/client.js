const API_BASE_URL = ''

export function setToken(token) {
  sessionStorage.setItem('hf_token', token)
}

export function getToken() {
  return sessionStorage.getItem('hf_token')
}

export function setRefreshToken(token) {
  sessionStorage.setItem('hf_refresh', token)
}

export function getRefreshToken() {
  return sessionStorage.getItem('hf_refresh')
}

export function clearTokens() {
  sessionStorage.removeItem('hf_token')
  sessionStorage.removeItem('hf_refresh')
  // Signing out ends the Broker's Working With focus for this tab.
  sessionStorage.removeItem('hf_working_with')
}

let refreshInFlight = null

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = exchangeRefreshToken().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

async function exchangeRefreshToken() {
  const refresh = getRefreshToken()
  if (!refresh) return false

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    })

    if (!res.ok) return false

    const data = await res.json()
    setToken(data.access_token)
    if (data.refresh_token) setRefreshToken(data.refresh_token)
    return true
  } catch {
    return false
  }
}

/** Sends an authenticated API request and retries once after refreshing an expired session. */
async function request(method, path, body = null, raw = false) {
  const multipart = body instanceof FormData
  const headers = multipart ? {} : { 'Content-Type': 'application/json' }
  const token = getToken()

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const config = { method, headers }
  if (body !== null) {
    config.body = multipart ? body : JSON.stringify(body)
  }

  let res = await fetch(`${API_BASE_URL}${path}`, config)

  // On 401, attempt token refresh and retry once
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = getToken() !== token && getToken() ? true : await refreshAccessToken()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getToken()}`
      res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: config.body })
    }
  }

  if (res.status === 401) {
    clearTokens()
    // Try the backend's specific message first (e.g. "Invalid email or
    // password" on a failed login). Fall back to a friendlier phrasing
    // than the verbatim HTTP status text.
    const errorData = await res.json().catch(() => ({}))
    const error = new Error(errorData.detail || 'Your session ended. Please sign in again.')
    error.status = 401
    error.data = errorData
    throw error
  }

  if (res.status === 204) {
    return null
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    const fallback =
      res.status >= 500
        ? "Our server hit a snag. Try again in a moment."
        : "Something didn't go through. Try again."
    const error = new Error(errorData.detail || fallback)
    error.status = res.status
    error.data = errorData
    throw error
  }

  return raw ? res : res.json()
}

async function openDocument(documentId) {
  // Reserve the tab during the click, before awaiting the authenticated fetch.
  const viewer = window.open('about:blank', '_blank')
  if (viewer) viewer.opener = null
  let release = () => {}
  try {
    const response = await request('GET', `/documents/${documentId}/content`, null, true)
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const url = URL.createObjectURL(blob)
    let timer
    release = () => {
      URL.revokeObjectURL(url)
      clearTimeout(timer)
      window.removeEventListener('pagehide', release)
    }
    window.addEventListener('pagehide', release, { once: true })
    timer = setTimeout(release, 60000)
    if (disposition.startsWith('attachment')) {
      viewer?.close()
      const link = document.createElement('a')
      link.href = url
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      try { link.download = encoded ? decodeURIComponent(encoded) : 'document' } catch { link.download = 'document' }
      document.body.appendChild(link)
      link.click()
      link.remove()
      clearTimeout(timer)
      timer = setTimeout(release, 1000)
    } else if (viewer) {
      viewer.location.replace(url)
    } else {
      release()
      throw new Error('Allow pop-ups to open this Document, then try again.')
    }
  } catch (error) {
    release()
    viewer?.close()
    throw error
  }
}

const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  uploadDocument: (clientId, file) => {
    const form = new FormData()
    form.append('file', file)
    return request('POST', `/clients/${clientId}/documents`, form)
  },
  openDocument,
}

export default api
