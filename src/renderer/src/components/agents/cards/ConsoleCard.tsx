/**
 * ConsoleCard — Router component that dispatches to type-specific card components.
 * Extracted from ConsoleLine.tsx as part of cards/ restructure.
 */
import type { ChatBlock } from '../../../lib/pair-events'
import type { PlaygroundContentType } from '../../../../../shared/types'
import { StartedCard } from './StartedCard'
import { TextCard } from './TextCard'
import { UserMessageCard } from './UserMessageCard'
import { ThinkingCard } from './ThinkingCard'
import { ToolCallCard } from './ToolCallCard'
import { ToolPairCard } from './ToolPairCard'
import { ToolGroupCard } from './ToolGroupCard'
import { StderrCard } from './StderrCard'
import { ErrorCard } from './ErrorCard'
import { RateLimitedCard } from './RateLimitedCard'
import { CompletionCard } from './CompletionCard'
import { PlaygroundCard } from './PlaygroundCard'

interface ConsoleCardProps {
  block: ChatBlock
  onPlaygroundClick?: (block: {
    filename: string
    html: string
    contentType: PlaygroundContentType
    sizeBytes: number
  }) => void
  searchHighlight?: 'match' | 'active' | undefined
}

export function ConsoleCard({
  block,
  onPlaygroundClick,
  searchHighlight
}: ConsoleCardProps): React.JSX.Element {
  const getSearchClass = (): string => {
    if (!searchHighlight) return ''
    return searchHighlight === 'active'
      ? ' console-line--search-active'
      : ' console-line--search-match'
  }

  switch (block.type) {
    case 'started':
      return (
        <StartedCard
          model={block.model}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'text':
      return (
        <TextCard text={block.text} timestamp={block.timestamp} searchClass={getSearchClass()} />
      )

    case 'user_message':
      return (
        <UserMessageCard
          text={block.text}
          timestamp={block.timestamp}
          pending={block.pending}
          searchClass={getSearchClass()}
        />
      )

    case 'thinking':
      return (
        <ThinkingCard
          tokenCount={block.tokenCount}
          text={block.text}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'tool_call':
      return (
        <ToolCallCard
          tool={block.tool}
          summary={block.summary}
          input={block.input}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'tool_pair':
      return (
        <ToolPairCard
          tool={block.tool}
          summary={block.summary}
          input={block.input}
          result={block.result}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'tool_group':
      return (
        <ToolGroupCard
          tools={block.tools}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
          onPlaygroundClick={onPlaygroundClick}
          searchHighlight={searchHighlight}
        />
      )

    case 'stderr':
      return (
        <StderrCard text={block.text} timestamp={block.timestamp} searchClass={getSearchClass()} />
      )

    case 'error':
      return (
        <ErrorCard
          message={block.message}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'rate_limited':
      return (
        <RateLimitedCard
          retryDelayMs={block.retryDelayMs}
          attempt={block.attempt}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
        />
      )

    case 'completed':
      return (
        <CompletionCard
          exitCode={block.exitCode}
          costUsd={block.costUsd}
          tokensIn={block.tokensIn}
          tokensOut={block.tokensOut}
          durationMs={block.durationMs}
        />
      )

    case 'playground':
      return (
        <PlaygroundCard
          filename={block.filename}
          sizeBytes={block.sizeBytes}
          timestamp={block.timestamp}
          searchClass={getSearchClass()}
          onPlaygroundClick={onPlaygroundClick}
          html={block.html}
          contentType={block.contentType}
        />
      )
  }
}
