import api from './client'

export const workspaceApi = {
  getToday: (localDate) => api.get(`/workspace/today${localDate ? `?local_date=${localDate}` : ''}`),
  getOverview: () => api.get('/workspace/overview'),
  listActivity: () => api.get('/workspace/activity?limit=200'),
  getPreferences: () => api.get('/workspace/preferences'),
  saveTimezone: (timezoneName) => api.put('/workspace/preferences', { timezone_name: timezoneName }),
  search: (query) => api.get(`/workspace/search?q=${encodeURIComponent(query)}&limit=8`),
  listOrganizations: (includeContacts = false, includeArchived = false) => api.get(`/organizations?include_contacts=${includeContacts}&include_archived=${includeArchived}`),
  getOrganization: (id) => api.get(`/organizations/${id}`),
  createOrganization: (body) => api.post('/organizations', body),
  updateOrganization: (id, body) => api.put(`/organizations/${id}`, body),
  archiveOrganization: (id) => api.post(`/organizations/${id}/archive`),
  restoreOrganization: (id) => api.post(`/organizations/${id}/restore`),
  createContact: (organizationId, body) => api.post(`/organizations/${organizationId}/contacts`, body),
  updateContact: (organizationId, contactId, body) => api.put(`/organizations/${organizationId}/contacts/${contactId}`, body),
  archiveContact: (organizationId, contactId) => api.post(`/organizations/${organizationId}/contacts/${contactId}/archive`),
  restoreContact: (organizationId, contactId) => api.post(`/organizations/${organizationId}/contacts/${contactId}/restore`),
  listTasks: (query = '', { limit = 50, offset = 0 } = {}) => {
    const params = new URLSearchParams(query)
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    return api.get(`/tasks?${params}`)
  },
  listAllTasks: async (query = '') => {
    const pageSize = 100
    const tasks = []
    for (;;) {
      const page = await workspaceApi.listTasks(query, { limit: pageSize, offset: tasks.length })
      tasks.push(...page)
      if (page.length < pageSize) return tasks
    }
  },
  createTask: (body) => api.post('/tasks', body),
  getTask: (id) => api.get(`/tasks/${encodeURIComponent(id)}`),
  updateTask: (id, body) => api.put(`/tasks/${id}`, body),
  completeTask: (id) => api.post(`/tasks/${id}/complete`),
  reopenTask: (id) => api.post(`/tasks/${id}/reopen`),
  listAppointments: (query = '') => api.get(`/appointments${query ? `?${query}` : ''}`),
  createAppointment: (body) => api.post('/appointments', body),
  getAppointment: (id) => api.get(`/appointments/${encodeURIComponent(id)}`),
  updateAppointment: (id, body) => api.put(`/appointments/${id}`, body),
  completeAppointment: (id) => api.post(`/appointments/${id}/complete`),
  cancelAppointment: (id) => api.post(`/appointments/${id}/cancel`),
  restoreAppointment: (id) => api.post(`/appointments/${id}/restore-scheduled`),
  listEnrollments: (query = '') => api.get(`/enrollments${query ? `?${query}` : ''}`),
  createEnrollment: (body) => api.post('/enrollments', body),
  updateEnrollment: (id, body) => api.put(`/enrollments/${id}`, body),
  readyEnrollment: (id) => api.post(`/enrollments/${id}/ready-to-submit`),
  submitEnrollment: (id, confirmed) => api.post(`/enrollments/${id}/submit`, { external_submission_confirmed: confirmed }),
  confirmEnrollment: (id) => api.post(`/enrollments/${id}/confirm`),
  cancelEnrollment: (id) => api.post(`/enrollments/${id}/cancel`),
  listIssues: (query = '') => api.get(`/issues${query ? `?${query}` : ''}`),
  getIssue: (id) => api.get(`/issues/${encodeURIComponent(id)}`),
  createIssue: (body) => api.post('/issues', body),
  updateIssue: (id, body) => api.put(`/issues/${id}`, body),
  createAppeal: (body) => api.post('/appeals', body),
  updateAppeal: (id, body) => api.put(`/appeals/${id}`, body),
}
