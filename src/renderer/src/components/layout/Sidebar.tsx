import { useFeatureFlags } from '../../stores/featureFlags'
import { SidebarV1 } from './SidebarV1'
import { SidebarV2 } from './SidebarV2'

interface SidebarProps {
  model?: string | undefined
}

export function Sidebar({ model }: SidebarProps): React.JSX.Element {
  const v2Shell = useFeatureFlags((s) => s.v2Shell)
  return v2Shell ? <SidebarV2 model={model} /> : <SidebarV1 model={model} />
}
