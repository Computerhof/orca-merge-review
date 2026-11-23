// `orca plugin check` and `orca plugin shot --scenario` render the panel with the real worker,
// over a real Git repository built in the temp folder for each scenario.
import { defineCheck } from 'orca/testing'
import { divergentRepo, hostResults, mergingRepo } from './testing/fixture'

export default defineCheck({
  compare: { results: hostResults(divergentRepo()) },
  resolving: { results: hostResults(mergingRepo()) },
  outsideRepo: {
    results: {
      'workspace.readContext': null,
      'workspace.list': { workspaces: [], truncated: false }
    }
  }
})
