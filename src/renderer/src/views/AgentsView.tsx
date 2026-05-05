import { useFeatureFlags } from '../stores/featureFlags'
import { AgentsViewV1 } from './AgentsViewV1'
import { AgentsViewV2 } from './AgentsViewV2'

export function AgentsView(): React.JSX.Element {
  const v2Agents = useFeatureFlags((s) => s.v2Agents)
  return v2Agents ? <AgentsViewV2 /> : <AgentsViewV1 />
}
