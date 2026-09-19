// Deliberately fictional fixtures. No mail provider or client record is queried.
export const MOCK_INBOX = [
  { id: 'mock-renewal-documents', sender: 'Dana Ruiz', email: 'dana@harbor-health.example', organization: 'Harbor Health', subject: 'Renewal documents are ready', preview: 'The updated renewal packet is available for review before Thursday.', receivedLabel: '9:14 AM', clientMatch: { clientIndex: 0, state: 'needs_confirmation' } },
  { id: 'mock-network-meeting', sender: 'Evan Brooks', email: 'evan@northstar-clinic.example', organization: 'Northstar Clinic', subject: 'Provider network meeting', preview: 'Can we review the network changes tomorrow afternoon?', receivedLabel: 'Yesterday', clientMatch: null },
  { id: 'mock-denial-notice', sender: 'Appeals Department', email: 'appeals@sample-carrier.example', organization: 'Sample Carrier', subject: 'Denial notice received', preview: 'A fictional denial notice is ready for broker review.', receivedLabel: 'Monday', clientMatch: { clientIndex: 2, state: 'needs_confirmation' } },
]
