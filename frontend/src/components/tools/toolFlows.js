// What each AI tool actually does and where its data comes from, shown while it
// runs and under its result. Keep these true to the backend: when a real
// connector replaces sample data (live plan feed, NPI registry, ...), update the
// matching step and source here.

export const TOOL_FLOWS = {
  compare: {
    steps: (input = {}) => [
      ['Loading plans for this ZIP', `ZIP ${input.zip || '—'} from the HealthFlow plan catalog`],
      ['Ranking plans for the client', `${input.income ? `${input.income[0].toUpperCase()}${input.income.slice(1)}` : 'Medium'}-income profile`],
      ['Estimating drug and procedure costs', `${input.meds || 0} medication${input.meds === 1 ? '' : 's'}, ${input.procs || 0} procedure${input.procs === 1 ? '' : 's'}`],
      ['Writing the recommendation', 'Claude reviews the ranked plans'],
      ['Recording the decision', 'Saved so you can see why later'],
    ],
    sources: [
      ['HealthFlow plan catalog', 'Sample plans while the CMS feed is offline'],
      ['Drug cost table', 'Sample tier copays'],
      ['Claude Haiku', 'Writes the recommendation'],
      ['Client profile', 'Entered by you'],
    ],
  },
  cost: {
    steps: (input = {}) => [
      ['Loading plans for this ZIP', `ZIP ${input.zip || '—'} from the HealthFlow plan catalog`],
      ['Ranking plans for the client', 'Premium, deductible, and out-of-pocket max'],
      ['Adding up the year', `${input.meds || 0} medication${input.meds === 1 ? '' : 's'}, ${input.visits || 0} visits, ${input.procs || 0} procedure${input.procs === 1 ? '' : 's'}`],
      ['Writing the summary', 'Claude explains the cheapest option'],
    ],
    sources: [
      ['HealthFlow plan catalog', 'Sample plans while the CMS feed is offline'],
      ['Drug cost table', 'Sample tier copays'],
      ['Claude Haiku', 'Writes the summary'],
      ['Usage', 'Entered by you'],
    ],
  },
  network: {
    steps: (input = {}) => [
      ['Loading plans for this ZIP', `ZIP ${input.zip || '—'} from the HealthFlow plan catalog`],
      ['Looking up providers', `${input.providers || 0} provider${input.providers === 1 ? '' : 's'} in the NPPES registry`],
      ['Checking plan networks and formularies', `${input.drugs || 0} prescription${input.drugs === 1 ? '' : 's'} against each plan`],
      ['Writing the summary', 'Claude compares coverage across plans'],
    ],
    sources: [
      ['NPPES NPI registry', 'Live provider lookup'],
      ['Provider network table', 'Sample networks, not plan directories'],
      ['Drug cost table', 'Sample formulary tiers'],
      ['Claude Haiku', 'Writes the summary'],
    ],
  },
  explain: {
    steps: () => [
      ['Reading the document', 'The plan text you pasted'],
      ['Finding the relevant sections', 'Parts that answer the question'],
      ['Writing a plain-language answer', 'Claude explains the coverage'],
    ],
    sources: [
      ['Plan document', 'Pasted by you'],
      ['Claude Sonnet', 'Writes the explanation'],
    ],
  },
  appeal: {
    steps: () => [
      ['Reading the denial', 'Reason, code, deadline, and treatment denied'],
      ['Matching the denial code', 'CMS guidance from the denial-code reference'],
      ['Writing the appeal letter', 'A draft for you to review and edit'],
      ['Saving the draft to the Issue', 'Kept with its deadline and follow-ups'],
    ],
    sources: [
      ['Denial letter', 'Pasted by you'],
      ['Denial-code reference', 'Curated CMS guidance by reason code'],
      ['Claude Opus', 'Analyzes the denial and drafts the letter'],
    ],
  },
}
