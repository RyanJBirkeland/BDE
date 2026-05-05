import { useFeatureFlags } from '../../stores/featureFlags'
import { UnifiedHeaderV1 } from './UnifiedHeaderV1'
import { UnifiedHeaderV2 } from './UnifiedHeaderV2'

export function UnifiedHeader(): React.JSX.Element {
  const v2Shell = useFeatureFlags((s) => s.v2Shell)
  return v2Shell ? <UnifiedHeaderV2 /> : <UnifiedHeaderV1 />
}
