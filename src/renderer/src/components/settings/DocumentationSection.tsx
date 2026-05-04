import { useRef, useState, useEffect, useCallback } from 'react'
import './DocumentationSection.css'
import type { DocSection, DocTopic } from '../../lib/documentation-data'
import { DOCUMENTATION_TOPICS } from '../../lib/documentation-data'

export function DocumentationSection(): React.JSX.Element {
  const [activeTopic, setActiveTopic] = useState(DOCUMENTATION_TOPICS[0]?.id ?? '')
  const topicRefs = useRef<Record<string, HTMLElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        setActiveTopic(entry.target.id)
      }
    }
  }, [])

  useEffect(() => {
    const root = contentRef.current
    if (!root) return

    const observer = new IntersectionObserver(handleIntersect, {
      root,
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0
    })

    for (const el of Object.values(topicRefs.current)) {
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [handleIntersect])

  function scrollToTopic(id: string): void {
    topicRefs.current[id]?.scrollIntoView({ behavior: 'smooth' })
    setActiveTopic(id)
  }

  return (
    <div className="doc-layout">
      <nav className="doc-nav" aria-label="Documentation topics">
        {DOCUMENTATION_TOPICS.map((topic) => {
          const Icon = topic.icon
          const isActive = topic.id === activeTopic
          return (
            <button
              key={topic.id}
              className={`doc-nav__item${isActive ? ' doc-nav__item--active' : ''}`}
              onClick={() => scrollToTopic(topic.id)}
              aria-current={isActive ? 'location' : undefined}
              type="button"
            >
              <Icon size={14} aria-hidden="true" />
              <span>{topic.label}</span>
            </button>
          )
        })}
      </nav>

      <div
        ref={contentRef}
        className="doc-content"
        role="region"
        aria-label="Documentation content"
      >
        {DOCUMENTATION_TOPICS.map((topic) => (
          <TopicSection
            key={topic.id}
            topic={topic}
            ref={(el) => {
              topicRefs.current[topic.id] = el
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface TopicSectionProps {
  topic: DocTopic
  ref: (el: HTMLElement | null) => void
}

function TopicSection({ topic, ref }: TopicSectionProps): React.JSX.Element {
  return (
    <section id={topic.id} ref={ref} aria-labelledby={`${topic.id}-heading`}>
      <h2 id={`${topic.id}-heading`} className="doc-topic__heading">
        {topic.label}
      </h2>
      <p className="doc-topic__description">{topic.description}</p>
      {topic.sections.map((section, i) => (
        <DocSectionCard key={i} section={section} />
      ))}
    </section>
  )
}

function DocSectionCard({ section }: { section: DocSection }): React.JSX.Element {
  return (
    <div className="doc-section">
      <h3 className="doc-section__heading">{section.heading}</h3>
      <p className="doc-section__body">{section.body}</p>
      {section.codeBlock && <CodeBlock block={section.codeBlock} />}
      {section.table && <DocTable table={section.table} />}
      {section.badges && section.badges.length > 0 && <BadgeList badges={section.badges} />}
    </div>
  )
}

function CodeBlock({
  block
}: {
  block: NonNullable<DocSection['codeBlock']>
}): React.JSX.Element {
  return (
    <div className="doc-code-block">
      {block.filename && <div className="doc-code-block__label">{block.filename}</div>}
      <pre className="doc-code-block__pre">
        <code>{block.content}</code>
      </pre>
    </div>
  )
}

function DocTable({ table }: { table: NonNullable<DocSection['table']> }): React.JSX.Element {
  return (
    <div className="doc-table-wrapper">
      <table className="doc-table">
        <thead>
          <tr>
            {table.headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BadgeList({
  badges
}: {
  badges: NonNullable<DocSection['badges']>
}): React.JSX.Element {
  return (
    <div className="doc-badges" role="list" aria-label="Examples">
      {badges.map((badge, i) => (
        <div
          key={i}
          role="listitem"
          className={`doc-badge doc-badge--${badge.variant}`}
          aria-label={`${badge.variant === 'pass' ? 'Correct' : 'Incorrect'}: ${badge.label}`}
        >
          <span className="doc-badge__indicator">{badge.variant === 'pass' ? 'PASS' : 'FAIL'}</span>
          <span className="doc-badge__label">{badge.label}</span>
        </div>
      ))}
    </div>
  )
}
