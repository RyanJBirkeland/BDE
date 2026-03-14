import { Panel, Group, Separator } from 'react-resizable-panels'
import { SessionList } from '../components/sessions/SessionList'
import { TaskComposer } from '../components/sessions/TaskComposer'
import { LiveFeed } from '../components/sessions/LiveFeed'
import { AgentDirector } from '../components/sessions/AgentDirector'
import { SessionLogViewer } from '../components/sessions/SessionLogViewer'

export function SessionsView(): React.JSX.Element {
  return (
    <Group orientation="horizontal" className="sessions-view">
      <Panel id="session-list" defaultSize="15" minSize="12" maxSize="25" className="sessions-view__panel">
        <SessionList />
      </Panel>

      <Separator className="sessions-view__handle" />

      <Panel id="task-composer" defaultSize="25" minSize="18" className="sessions-view__panel">
        <TaskComposer />
      </Panel>

      <Separator className="sessions-view__handle" />

      <Panel id="right-pane" defaultSize="30" minSize="20" className="sessions-view__panel">
        <div className="sessions-view__right">
          <Group orientation="vertical">
            <Panel id="live-feed" defaultSize="70" minSize="30" className="sessions-view__panel">
              <LiveFeed />
            </Panel>

            <Separator className="sessions-view__handle sessions-view__handle--horizontal" />

            <Panel id="agent-director" defaultSize="30" minSize="15" className="sessions-view__panel">
              <AgentDirector />
            </Panel>
          </Group>
        </div>
      </Panel>

      <Separator className="sessions-view__handle" />

      <Panel id="session-log" defaultSize="30" minSize="20" className="sessions-view__panel">
        <SessionLogViewer />
      </Panel>
    </Group>
  )
}
