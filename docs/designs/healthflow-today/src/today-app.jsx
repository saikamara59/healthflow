/* global React, ReactDOM */
const { useState, useEffect, useRef, useMemo } = React;

const NOW = new Date(2026, 8, 27, 10, 40);
const TZ = 'America/New_York';
const d = (day, h = 0, m = 0) => new Date(2026, 8, day, h, m);
const DAY_MS = 86400000;
const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
const TODAY0 = startOfDay(NOW);
const fmtTime = (x) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDay = (x) => x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

const CLIENTS = (window.CLIENT_ROWS || []).map(c => c.name);
const ORGS = [
  { name: 'Aetna', kind: 'Carrier' }, { name: 'Humana', kind: 'Carrier' }, { name: 'Cigna', kind: 'Carrier' },
  { name: 'Upper West Cardiology', kind: 'Provider office' }, { name: 'Kamara Benefits Group', kind: 'Agency' },
];
const CONTACTS = [
  { name: 'Dana Whitfield', org: 'Aetna', role: 'Broker services' },
  { name: 'Luis Ferreira', org: 'Humana', role: 'Appeals coordinator' },
  { name: 'Dr. Anika Patel', org: 'Upper West Cardiology', role: 'Cardiologist' },
];

const SEED_TASKS = [
  { id: 't1', title: 'Send Scope of Appointment form', due: d(25, 17), priority: 'High', client: 'Howard Tenenbaum' },
  { id: 't2', title: 'Confirm Tier 5 formulary coverage for Humira', due: d(26, 12), followup: true, client: 'Priya Ramanathan', org: 'Humana' },
  { id: 't3', title: 'Call about pharmacy network change', due: d(27, 11, 30), followup: true, priority: 'High', client: 'Inés Ortega-Ruiz' },
  { id: 't4', title: 'Upload denial letter to the appeal Issue', due: d(27, 15), client: 'Otis Brewer', org: 'Cigna' },
  { id: 't5', title: 'Review 2027 ANOC changes', due: d(27, 17), org: 'Aetna', contact: 'Dana Whitfield' },
  { id: 't6', title: 'Prepare AEP renewal packet', due: d(30, 12), client: 'Marjorie Calloway' },
  { id: 't7', title: 'Research PPO options for Brooklyn clients', due: null },
];
const SEED_APPTS = [
  { id: 'a1', title: 'Intake call', start: d(27, 9), end: d(27, 9, 30), client: 'Darnell Washington' },
  { id: 'a2', title: 'Plan review', start: d(27, 10, 30), end: d(27, 11, 15), client: 'Marjorie Calloway' },
  { id: 'a3', title: 'Appeal prep with cardiology office', start: d(27, 14), end: d(27, 14, 30), client: 'Otis Brewer', contact: 'Dr. Anika Patel', org: 'Upper West Cardiology' },
  { id: 'a4', title: 'Humana broker update', start: d(28, 10), end: d(28, 10, 45), org: 'Humana', contact: 'Luis Ferreira' },
  { id: 'a5', title: 'Enrollment review', start: d(30, 13), end: d(30, 13, 45), client: 'Howard Tenenbaum' },
  { id: 'a6', title: 'AEP kickoff with agency team', start: new Date(2026, 9, 2, 11), end: new Date(2026, 9, 2, 12), org: 'Kamara Benefits Group' },
  { id: 'a7', title: 'Annual review', start: new Date(2026, 9, 8, 10), end: new Date(2026, 9, 8, 10, 30), client: 'Priya Ramanathan' },
];
const MAIL = [
  { id: 'm1', from: 'Dana Whitfield', email: 'dana.whitfield@aetna.example', subject: '2027 ANOC letters are available', preview: 'Annual Notice of Change letters for your book are posted in the broker portal. Key changes include…', time: '9:12 AM', match: { kind: 'Contact', label: 'Dana Whitfield · Aetna' } },
  { id: 'm2', from: 'marjorie.c@example.com', email: 'marjorie.c@example.com', subject: 'Question about my dental coverage', preview: 'Hi, before our call today, does my plan cover crowns? My dentist said…', time: '8:47 AM', suggest: 'Marjorie Calloway' },
  { id: 'm3', from: 'Luis Ferreira', email: 'lferreira@humana.example', subject: 'Appeal status update', preview: 'We received the additional documentation and expect a decision within 10 business days.', time: 'Yesterday', match: { kind: 'Contact', label: 'Luis Ferreira · Humana' } },
];

const P = {
  today: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  overview: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  clients: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  orgs: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  enroll: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z',
  issues: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  docs: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  follow: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99',
  cal: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  ask: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z',
  compare: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  cost: 'M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z',
  network: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z',
  explain: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  appeal: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10',
  search: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  x: 'M6 18 18 6M6 6l12 12',
  chev: 'm8.25 4.5 7.5 7.5-7.5 7.5',
  link: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
  settings: 'M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  download: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  history: 'M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3',
  archive: 'm20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9',
  moon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  chevL: 'M15.75 19.5 8.25 12l7.5-7.5',
  arrowDown: 'M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3',
  arrowUp: 'M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18',
  mail: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
};
const PH = { today: 'clock', overview: 'squares-four', clients: 'users-three', orgs: 'buildings', enroll: 'clipboard-text', issues: 'warning-circle', docs: 'file-text', follow: 'arrows-clockwise', cal: 'calendar-blank', ask: 'chat-circle-dots', compare: 'arrows-left-right', cost: 'calculator', network: 'seal-check', explain: 'book-open-text', appeal: 'pencil-simple-line', approve: 'stamp', team: 'identification-badge', connect: 'plugs-connected', search: 'magnifying-glass', bell: 'bell', plus: 'plus', x: 'x', chev: 'caret-right', chevL: 'caret-left', link: 'link-simple', settings: 'gear-six', mail: 'envelope-simple', download: 'download-simple', history: 'clock-counter-clockwise', archive: 'archive', logout: 'sign-out', moon: 'moon', arrowDown: 'arrow-down', arrowUp: 'arrow-up' };
const PH_BOLD = new Set(['plus', 'x', 'chev', 'chevL', 'arrowDown', 'arrowUp']);
const Ico = ({ n, s = 18, className = 'nav-ic' }) => (
  <i className={`${PH_BOLD.has(n) ? 'ph-bold' : 'ph-duotone'} ph-${PH[n] || 'circle'} hf-ic ${className}`} style={{ fontSize: s }} aria-hidden="true" />
);

const Tile = ({ n, c, lg }) => <span className={`hf-tile ${lg ? 'lg' : ''}`} data-c={c || n} aria-hidden="true"><Ico n={n} className="" /></span>;

const NAV = [
  { group: 'Daily', items: [['Today', 'today'], ['Approvals', 'approve'], ['Overview', 'overview']] },
  { group: 'Workspace', items: [['Clients', 'clients'], ['Organizations', 'orgs'], ['Enrollments', 'enroll'], ['Issues & Appeals', 'issues'], ['Documents', 'docs'], ['Follow-ups', 'follow'], ['Scheduling', 'cal']] },
  { group: 'AI Tools', items: [['Ask HealthFlow', 'ask'], ['Compare Plans', 'compare'], ['Estimate Costs', 'cost'], ['Check Network', 'network'], ['Explain Coverage', 'explain'], ['Draft Appeal', 'appeal']] },
  { group: 'Account', items: [['Activity', 'history'], ['Tool history', 'today']] },
  { group: 'Administration', items: [['Team', 'team']] },
  { group: 'Settings', items: [['Connectors', 'connect']] },
];
const PARENT = { 'Archived documents': 'Documents' };
const ROUTE_IC = Object.fromEntries(NAV.flatMap(g => g.items.map(([l, ic]) => [l, ic])));
ROUTE_IC['Archived documents'] = ROUTE_IC['Documents'];
const GROUP_OF = Object.fromEntries(NAV.flatMap(g => g.items.map(([l]) => [l, g.group])));
const TOOLS = NAV[2].items;

const Mark = ({ s = 28 }) => (
  <svg viewBox="0 0 32 32" width={s} height={s} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="16" cy="16" r="15" fill="var(--accent-soft)" stroke="var(--accent-line)" />
    <path d="M7 10 C 14 10, 16 16, 23 16" strokeWidth="2.2" stroke="oklch(0.65 0.15 185)" />
    <path d="M7 16 L 23 16" strokeWidth="2.2" stroke="oklch(0.55 0.14 200)" />
    <path d="M7 22 C 14 22, 16 16, 23 16" strokeWidth="2.2" stroke="oklch(0.46 0.13 215)" />
    <circle cx="24" cy="16" r="3" fill="var(--ink)" />
  </svg>
);

const Links = ({ r }) => {
  const parts = [r.client, r.org, r.contact].filter(Boolean);
  return parts.length ? <small><Ico n="link" s={11} className="td-inline-ic" /> {parts.join(' · ')}</small> : null;
};

function Sidebar({ onNav, route, approvalsN = 0 }) {
  return (
    <aside className="side">
      <div className="brand"><Mark /><span className="td-wordmark">Health<span>Flow</span></span></div>
      <nav aria-label="Primary">
        {NAV.map(g => (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map(([label, ic]) => (
              <button key={label} className={`nav-item ${label === (PARENT[route] || route) ? 'active' : ''}`} aria-current={label === (PARENT[route] || route) ? 'page' : undefined} onClick={() => onNav(label)}>
                <Tile n={ic} /><span>{label}</span>{label === 'Clients' && <span className="nav-count">{CLIENTS.length}</span>}{label === 'Approvals' && approvalsN > 0 && <span className="nav-count ap-nav-n">{approvalsN}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="bottom">
        <div className="user-chip"><span className="avatar">SK</span><div className="td-user"><strong>Sai Kamara</strong><small>Broker</small></div><button className="btn ghost icon sm td-logout" aria-label="Sign out" onClick={() => onNav('Sign out')}><Ico n="logout" className="" /></button></div>
      </div>
    </aside>
  );
}

function SearchDialog({ open, onClose, tasks, appts, onPick }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (open && !el.open) { el.showModal(); setQ(''); setActive(0); }
    if (!open && el.open) el.close();
  }, [open]);
  const all = useMemo(() => [
    ...CLIENTS.map(n => ({ type: 'Client', label: n })),
    ...ORGS.map(o => ({ type: 'Organization', label: o.name, sub: o.kind })),
    ...CONTACTS.map(c => ({ type: 'Contact', label: c.name, sub: `${c.role} · ${c.org}` })),
    ...tasks.map(t => ({ type: 'Task', label: t.title, sub: t.client || t.org })),
    ...appts.map(a => ({ type: 'Appointment', label: a.title, sub: `${fmtDay(a.start)} · ${fmtTime(a.start)}` })),
  ], [tasks, appts]);
  const res = q.trim() ? all.filter(r => (r.label + ' ' + (r.sub || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, res.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && res[active]) { e.preventDefault(); onPick(res[active]); }
  };
  return (
    <dialog ref={ref} className="workspace-dialog workspace-search-dialog" onClose={onClose} aria-label="Search workspace">
      <div className="between"><h2>Search</h2><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Ico n="x" /></button></div>
      <input autoFocus value={q} onChange={e => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} placeholder="Clients, organizations, contacts, tasks, appointments" aria-label="Search" />
      <div className="workspace-search-hint">Only your records appear. Use ↑ ↓ to move, Enter to open, Esc to close.</div>
      {q.trim() && res.length === 0 && <p className="workspace-empty">No matches for “{q}”.</p>}
      {res.map((r, i) => (
        <button key={r.type + r.label} className={`workspace-search-result ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => onPick(r)}>
          <span>{r.label}{r.sub && <small> · {r.sub}</small>}</span><small>{r.type}</small>
        </button>
      ))}
    </dialog>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const toDateInput = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
const toTimeInput = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
const fromInputs = (date, time) => { const [y, m, dd] = date.split('-').map(Number); const [h, mi] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };

function CreateDialog({ state, onClose, onSave }) {
  const ref = useRef(null);
  const [f, setF] = useState({});
  const [errs, setErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const kind = state?.kind;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (state && !el.open) {
      const p = state.prefill || {};
      setF({ title: p.title || '', notes: p.notes || '', priority: '', date: p.date || toDateInput(NOW), time: '', start: '13:00', end: '13:30', followup: !!p.followup, client: p.client || '', org: p.org || '', contact: p.contact || '' });
      setErrs({}); setSaving(false); el.showModal();
    }
    if (!state && el.open) el.close();
  }, [state]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!f.title.trim()) er.title = 'Add a title.';
    if (kind === 'appt') {
      if (!f.date) er.date = 'Choose a date.';
      else if (fromInputs(f.date, f.end) <= fromInputs(f.date, f.start)) er.end = 'End time must be after the start time.';
    }
    setErrs(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    setTimeout(() => {
      const links = { client: f.client || undefined, org: f.org || undefined, contact: f.contact || undefined };
      if (kind === 'task') onSave('task', { id: 't' + Date.now(), title: f.title.trim(), notes: f.notes, priority: f.priority || undefined, followup: f.followup, due: f.date ? fromInputs(f.date, f.time || '17:00') : null, ...links });
      else onSave('appt', { id: 'a' + Date.now(), title: f.title.trim(), notes: f.notes, start: fromInputs(f.date, f.start), end: fromInputs(f.date, f.end), ...links });
    }, 350);
  };
  const LinkFields = () => (
    <div className="workspace-form-grid td-links">
      <label>Client<select value={f.client} onChange={set('client')}><option value="">None</option>{CLIENTS.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Organization<select value={f.org} onChange={set('org')}><option value="">None</option>{ORGS.map(o => <option key={o.name}>{o.name}</option>)}</select></label>
      <label className="td-span2">Contact<select value={f.contact} onChange={set('contact')}><option value="">None</option>{CONTACTS.map(c => <option key={c.name} value={c.name}>{c.name} · {c.org}</option>)}</select></label>
    </div>
  );
  return (
    <dialog ref={ref} className="workspace-dialog" onClose={onClose} aria-labelledby="cd-title">
      {state && (
        <form onSubmit={submit} noValidate>
          <div className="between"><h2 id="cd-title">{kind === 'task' ? 'New task' : 'New appointment'}</h2><button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Ico n="x" /></button></div>
          {state.prefill?.fromMail && <div className="td-prefill">Prefilled from sample message: “{state.prefill.fromMail}”</div>}
          <label>Title<input value={f.title} onChange={set('title')} aria-invalid={!!errs.title} autoFocus />{errs.title && <span className="td-err">{errs.title}</span>}</label>
          {kind === 'task' ? (
            <div className="workspace-form-grid">
              <label>Due date<input type="date" value={f.date} onChange={set('date')} /></label>
              <label>Due time<input type="time" value={f.time} onChange={set('time')} /></label>
              <label>Priority<select value={f.priority} onChange={set('priority')}><option value="">None</option><option>High</option><option>Medium</option><option>Low</option></select></label>
              <label className="workspace-check td-check"><input type="checkbox" checked={f.followup} onChange={set('followup')} /> Follow-up</label>
              <small className="workspace-small td-span2">Leave the date empty to keep this in Unscheduled.</small>
            </div>
          ) : (
            <div className="workspace-form-grid">
              <label className="td-span2">Date<input type="date" value={f.date} onChange={set('date')} aria-invalid={!!errs.date} />{errs.date && <span className="td-err">{errs.date}</span>}</label>
              <label>Start<input type="time" value={f.start} onChange={set('start')} /></label>
              <label>End<input type="time" value={f.end} onChange={set('end')} aria-invalid={!!errs.end} />{errs.end && <span className="td-err">{errs.end}</span>}</label>
            </div>
          )}
          <LinkFields />
          <label>Notes<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
          <div className="quick-create-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn accent" disabled={saving}>{saving ? 'Saving…' : kind === 'task' ? 'Create task' : 'Create appointment'}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function TaskRow({ t, onDone }) {
  const overdue = t.due && t.due < NOW;
  return (
    <li className="workspace-list-row">
      <input type="checkbox" aria-label={`Complete ${t.title}`} onChange={() => onDone(t)} />
      <div className="workspace-row-copy">
        <strong>{t.title}</strong>
        <Links r={t} />
      </div>
      <div className="td-row-meta">
        {t.followup && <span className="workspace-tag">Follow-up</span>}
        {t.priority === 'High' && <span className="chip warn">High</span>}
        <span className={`td-when ${overdue ? 'neg' : ''}`}>{overdue ? (sameDay(t.due, NOW) ? fmtTime(t.due) : fmtDay(t.due)) : fmtTime(t.due)}</span>
      </div>
    </li>
  );
}

function ApptRow({ a, onComplete, showDay }) {
  const current = a.start <= NOW && a.end > NOW;
  const past = a.end <= NOW && a.status !== 'Completed';
  return (
    <li className={`workspace-list-row td-appt ${current ? 'td-now' : ''}`}>
      <div className="td-time"><strong>{showDay ? fmtDay(a.start) : fmtTime(a.start)}</strong><small>{showDay ? fmtTime(a.start) : fmtTime(a.end)}</small></div>
      <div className="workspace-row-copy">
        <strong>{a.title}</strong>
        <Links r={a} />
      </div>
      <div className="td-row-meta">
        {current && <span className="chip accent">In progress</span>}
        {past && <span className="chip warn">Needs follow-up</span>}
        {past && <button className="btn sm" onClick={() => onComplete(a)}>Mark completed</button>}
      </div>
    </li>
  );
}

function TodayApp() {
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [appts, setAppts] = useState(SEED_APPTS);
  const [dialog, setDialog] = useState(null);
  const [search, setSearch] = useState(false);
  const [toast, setToast] = useState(null);
  const [linked, setLinked] = useState({});
  const [done, setDone] = useState([]);
  const [docs, setDocs] = useState(window.SEED_DOCS || []);
  const [workingWith, setWorkingWith] = useState('');
  const [approvals, setApprovals] = useState(window.SEED_APPROVALS || []);
  const [activity, setActivity] = useState([
    { kind: 'Tool', tone: 'accent', text: 'Compare Plans ranked Aetna Prime HMO first', client: 'Marjorie Calloway', when: '9:58 AM' },
    { kind: 'Appointment', tone: 'pos', text: 'Completed intake call', client: 'Darnell Washington', when: '9:34 AM' },
    { kind: 'Tool', tone: 'accent', text: 'Explain Coverage answered a dental question', client: 'Marjorie Calloway', when: '9:20 AM' },
    { kind: 'Task', tone: 'pos', text: 'Completed: Send plan summary', client: 'Howard Tenenbaum', when: 'Yesterday' },
    { kind: 'Document', tone: '', text: 'Uploaded Pharmacy network notice.png', client: 'Inés Ortega-Ruiz', when: 'Sep 25' },
  ]);
  const log = (e) => setActivity(a => [{ when: fmtTime(NOW), ...e }, ...a]);
  const toastTimer = useRef(null);

  const flash = (msg, undo) => { clearTimeout(toastTimer.current); setToast({ msg, undo }); toastTimer.current = setTimeout(() => setToast(null), 5000); };
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const open = tasks.filter(t => !done.includes(t.id));
  const overdue = open.filter(t => t.due && t.due < TODAY0 || (t.due && t.due < NOW && sameDay(t.due, NOW) && false)).concat(open.filter(t => t.due && sameDay(t.due, NOW) && t.due < NOW)).sort((a, b) => a.due - b.due);
  const dueToday = open.filter(t => t.due && sameDay(t.due, NOW) && t.due >= NOW).sort((a, b) => a.due - b.due);
  const unscheduled = open.filter(t => !t.due);
  const meetings = appts.filter(a => sameDay(a.start, NOW) && a.status !== 'Canceled').sort((a, b) => a.start - b.start);
  const weekEnd = new Date(TODAY0.getTime() + 8 * DAY_MS);
  const upcoming = appts.filter(a => a.start >= new Date(TODAY0.getTime() + DAY_MS) && a.start < weekEnd).sort((a, b) => a.start - b.start);

  const completeTask = (t) => { setDone(d => [...d, t.id]); log({ kind: 'Task', tone: 'pos', text: `Completed: ${t.title}`, client: t.client }); flash(`Completed “${t.title}”. Added to Activity.`, () => setDone(d => d.filter(x => x !== t.id))); };
  const completeAppt = (a) => { setAppts(list => list.map(x => x.id === a.id ? { ...x, status: 'Completed' } : x)); log({ kind: 'Appointment', tone: 'pos', text: `Completed ${a.title.toLowerCase()}`, client: a.client }); flash(`Marked “${a.title}” completed. Added to Activity.`); };
  const onSave = (kind, rec) => {
    if (kind === 'task') { setTasks(l => [...l, rec]); flash(rec.due ? `Task created for ${fmtDay(rec.due)}.` : 'Task created in Unscheduled.'); }
    else { setAppts(l => [...l, rec]); flash(`Appointment created for ${fmtDay(rec.start)} at ${fmtTime(rec.start)}.`); }
    setDialog(null);
  };
  const fromMail = (m, kind) => setDialog({ kind, prefill: { title: kind === 'task' ? `Reply: ${m.subject}` : m.subject, fromMail: m.subject, notes: m.preview, followup: kind === 'task', client: linked[m.id] ? m.suggest : '', contact: m.match?.kind === 'Contact' ? m.match.label.split(' · ')[0] : '', org: m.match ? m.match.label.split(' · ')[1] : '' } });
  const [route, setRoute] = useState(() => decodeURIComponent(location.hash.slice(1)) || 'Today');
  useEffect(() => { const h = () => setRoute(decodeURIComponent(location.hash.slice(1)) || 'Today'); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  const PAGES = window.WS_PAGES || {};
  const nav = (label) => { if (label === 'Today' || PAGES[label]) { location.hash = encodeURIComponent(label); scrollTo(0, 0); } else flash(`${label} is not in this prototype yet.`); };
  const Page = route !== 'Today' ? PAGES[route] : null;
  const ctx = { client: workingWith, setClient: setWorkingWith, tasks, appts, done, flash, openCreate: (d) => setDialog(d && workingWith ? { ...d, prefill: { client: workingWith, ...(d.prefill || {}) } } : d), completeTask, completeAppt, nav, docs, setDocs, activity, approvals, setApprovals };

  window.WS_ROUTE_IC = route ? ROUTE_IC[route] : null;
  return (
    <div className="app">
      <Sidebar onNav={nav} route={Page ? route : 'Today'} approvalsN={approvals.filter(x => x.status === 'pending').length} />
      <div className="main">
        <header className="topbar">
          <div className="crumbs"><span>{Page ? GROUP_OF[PARENT[route] || route] : 'Daily'}</span><span className="sep">/</span>{PARENT[route] && <><button className="crumb-link" onClick={() => nav(PARENT[route])}>{PARENT[route]}</button><span className="sep">/</span></>}<span className="here">{Page ? route : 'Today'}</span></div>
          <div className="row">
            <button className="search workspace-search-trigger" onClick={() => setSearch(true)}><Ico n="search" s={14} /><span className="td-grow">Search workspace</span><span className="kbd">⌘K</span></button>
            {route === 'Clients' && Page && <button className="btn accent" onClick={() => flash('Opens the new client form in the full app.')}><Ico n="plus" s={15} className="" /> Add client</button>}
            <button className="btn ghost icon" aria-label="Notifications" onClick={() => flash('No new notifications.')}><Ico n="bell" className="" /></button>
            <button className="btn ghost icon" aria-label="Toggle dark mode" onClick={() => { const r = document.documentElement; r.dataset.mode = r.dataset.mode === 'dark' ? 'light' : 'dark'; }}><Ico n="moon" className="" /></button>
            <span className="tm-divider" aria-hidden="true" />
            <window.TeamSwitcher flash={flash} />
          </div>
        </header>

        <div className="qa-strip">
          <div className="qa-actions" role="toolbar" aria-label="Quick actions">
            {route !== 'Today' && Page && <>
              <button className="qa-btn" onClick={() => ctx.openCreate({ kind: 'task' })}><Tile n="follow" />New task</button>
              <button className="qa-btn" onClick={() => ctx.openCreate({ kind: 'appt' })}><Tile n="cal" />New appointment</button>
            </>}
            {[['Compare Plans', 'compare'], ['Ask HealthFlow', 'ask'], ['Explain Coverage', 'explain']].filter(([l]) => l !== route).map(([l, ic]) => (
              <button key={l} className="qa-btn" onClick={() => nav(l)}><Tile n={ic} />{l}</button>
            ))}
          </div>
          <div className={`ww ${workingWith ? 'on' : ''}`}>
            <i className="ph-duotone ph-user-focus" aria-hidden="true" />
            <label className="ww-label" htmlFor="ww-sel">Working with</label>
            <select id="ww-sel" value={workingWith} onChange={e => { setWorkingWith(e.target.value); if (e.target.value) flash(`Tools will use ${e.target.value}'s details.`); }}>
              <option value="">No client selected</option>
              {(window.CLIENT_ROWS || []).map(c => <option key={c.name}>{c.name}</option>)}
            </select>
            {workingWith && <button className="ww-x" onClick={() => setWorkingWith('')} aria-label="Stop working with this client"><Ico n="x" s={12} className="" /></button>}
          </div>
        </div>

        <div className="page ws-page-in" key={route || 'Today'} data-c={ROUTE_IC[route] || 'today'}>
          {Page ? <Page ctx={ctx} /> : <>
          <div className="page-head td-head">
            <div>
              <div className="eyebrow">{NOW.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · Times in {TZ}</div>
              <div className="ws-title-row"><Tile n="today" lg /><h1 className="page-title">Today</h1></div>
              <p className="page-sub">{overdue.length} overdue, {dueToday.length} due later today, and {meetings.filter(m => m.end > NOW).length} meetings still ahead.</p>
            </div>
            <div className="quick-create-actions">
              <button className="btn" onClick={() => setDialog({ kind: 'appt' })}><Ico n="cal" s={15} className="" /> New appointment</button>
              <button className="btn accent" onClick={() => setDialog({ kind: 'task' })}><Ico n="plus" s={15} className="" /> New task</button>
            </div>
          </div>

          <div className="today-grid">
            <div className="today-main">
              <section className="card workspace-section" aria-labelledby="h-tasks">
                <div className="between"><h2 id="h-tasks" className="ws-h2"><Tile n="today" c="cost" />Tasks</h2><span className="workspace-count">{overdue.length + dueToday.length} open today</span></div>
                <div className="workspace-subheading td-neg">Overdue · {overdue.length}</div>
                {overdue.length ? <ul className="workspace-list">{overdue.map(t => <TaskRow key={t.id} t={t} onDone={completeTask} />)}</ul> : <p className="workspace-empty">Nothing overdue.</p>}
                <div className="workspace-subheading">Due today · {dueToday.length}</div>
                {dueToday.length ? <ul className="workspace-list">{dueToday.map(t => <TaskRow key={t.id} t={t} onDone={completeTask} />)}</ul> : <p className="workspace-empty">No other tasks due today.</p>}
                <div className="td-foot">
                  <button className="td-link" onClick={() => nav('Unscheduled tasks')}>{unscheduled.length} unscheduled task{unscheduled.length === 1 ? '' : 's'}</button>
                  {done.length > 0 && <span className="workspace-small">{done.length} completed today</span>}
                </div>
              </section>

              <section className="card workspace-section" aria-labelledby="h-meet">
                <div className="between"><h2 id="h-meet" className="ws-h2"><Tile n="cal" c="today" />My Meetings</h2><button className="td-link" onClick={() => nav('Scheduling')}>Open Scheduling</button></div>
                {meetings.length ? <ul className="workspace-list">{meetings.map(a => <ApptRow key={a.id} a={a} onComplete={completeAppt} />)}</ul> : <p className="workspace-empty">No meetings today.</p>}
              </section>

              <section className="card workspace-section" aria-labelledby="h-up">
                <div className="between"><h2 id="h-up" className="ws-h2"><Tile n="cal" c="compare" />Upcoming</h2><span className="workspace-small">Next 7 days</span></div>
                {upcoming.length ? <ul className="workspace-list">{upcoming.map(a => <ApptRow key={a.id} a={a} showDay onComplete={completeAppt} />)}</ul> : <p className="workspace-empty">Nothing scheduled this week.</p>}
              </section>
            </div>

            <div className="today-rail">
              <window.ApprovalsCard ctx={ctx} />
              <section className="card workspace-section" aria-labelledby="h-inbox">
                <div className="between"><h2 id="h-inbox" className="ws-h2"><Tile n="mail" c="explain" />Inbox</h2><span className="chip ghost">Sample data</span></div>
                <p className="workspace-small td-inbox-note">Example messages only. No mailbox is connected and nothing is sent or stored.</p>
                <ul className="workspace-list">
                  {MAIL.map(m => (
                    <li key={m.id} className="workspace-list-row workspace-mail mail-head">
                      <window.OrgLogo name={m.match ? m.match.label.split(' · ')[1] : m.from} email={m.email} size={34} />
                      <div className="workspace-row-copy">
                        <div className="between"><strong>{m.subject}</strong><small>{m.time}</small></div>
                        <small>{m.from}</small>
                        <small className="td-preview">{m.preview}</small>
                        {m.match && <small className="td-match"><Ico n="link" s={11} className="td-inline-ic" /> Matched {m.match.kind.toLowerCase()}: {m.match.label}</small>}
                        {m.suggest && (
                          <div className="workspace-link-suggestion">
                            <div><small>Possible client match</small>{linked[m.id] ? <span className="workspace-link-confirmed">Linked to {m.suggest}</span> : <strong>{m.suggest}</strong>}</div>
                            {!linked[m.id] && <button className="btn sm" onClick={() => { setLinked({ ...linked, [m.id]: true }); flash(`Linked message to ${m.suggest}.`); }}>Confirm link</button>}
                          </div>
                        )}
                        <div className="quick-create-actions">
                          <button className="btn sm" onClick={() => fromMail(m, 'task')}>Create task</button>
                          <button className="btn sm" onClick={() => fromMail(m, 'appt')}>Create appointment</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card workspace-section" aria-labelledby="h-tools">
                <h2 id="h-tools" className="ws-h2"><Tile n="ask" />Tools</h2>
                <div className="workspace-tools">
                  {TOOLS.map(([label, ic]) => (
                    <a key={label} className="workspace-tool" href="#" onClick={(e) => { e.preventDefault(); nav(label); }}><Tile n={ic} /><span>{label}</span><Ico n="chev" s={14} /></a>
                  ))}
                </div>
              </section>
            </div>
          </div>
          </>}
        </div>
      </div>

      <CreateDialog state={dialog} onClose={() => setDialog(null)} onSave={onSave} />
      <SearchDialog open={search} onClose={() => setSearch(false)} tasks={open} appts={appts} onPick={(r) => { setSearch(false); nav(`${r.type}: ${r.label}`); }} />
      {toast && <div className="td-toast" role="status">{toast.msg}{toast.undo && <button onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}</div>}
    </div>
  );
}

window.WS = { NOW, TODAY0, DAY_MS, sameDay, fmtTime, fmtDay, Links, TZ };
window.Ico = Ico;
window.WSTile = Tile;
window.WSMark = Mark;
ReactDOM.createRoot(document.getElementById('root')).render(<TodayApp />);
