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
}
