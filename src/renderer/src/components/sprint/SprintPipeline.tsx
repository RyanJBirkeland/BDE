import { useFeatureFlags } from '../../stores/featureFlags'
import { SprintPipelineV1 } from './SprintPipelineV1'
import { SprintPipelineV2 } from './SprintPipelineV2'

export function SprintPipeline(): React.JSX.Element {
  const v2Pipeline = useFeatureFlags((s) => s.v2Pipeline)
  return v2Pipeline ? <SprintPipelineV2 /> : <SprintPipelineV1 />
}
