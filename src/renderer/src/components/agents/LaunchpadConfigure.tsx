import { useState, useCallback, useRef, useEffect } from 'react'
import type { PromptTemplate } from '../../lib/launchpad-types'

interface LaunchpadConfigureProps {
  template: PromptTemplate
  onComplete: (answers: Record<string, string>) => void
  onBack: () => void
}

interface ChatMessage {
  type: 'system' | 'user'
  text: string
  questionId?: string
  choices?: string[]
  questionType?: 'choice' | 'text' | 'multi-choice'
}

export function LaunchpadConfigure({ template, onComplete, onBack }: LaunchpadConfigureProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentStep, setCurrentStep] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const totalSteps = template.questions.length

  // Initialize first question
  useEffect(() => {
    if (template.questions.length > 0) {
      const q = template.questions[0]
      setMessages([
        {
          type: 'system',
          text: q.label,
          questionId: q.id,
          choices: q.choices,
          questionType: q.type
        }
      ])
    }
  }, [template])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const advanceOrComplete = useCallback(
    (newAnswers: Record<string, string>, nextStep: number) => {
      if (nextStep >= totalSteps) {
        onComplete(newAnswers)
        return
      }

      const q = template.questions[nextStep]
      setMessages((prev) => [
        ...prev,
        {
          type: 'system',
          text: q.label,
          questionId: q.id,
          choices: q.choices,
          questionType: q.type
        }
      ])
      setCurrentStep(nextStep)
      setInputValue('')
      inputRef.current?.focus()
    },
    [template, totalSteps, onComplete]
  )

  const handleChoiceClick = useCallback(
    (choice: string) => {
      const q = template.questions[currentStep]
      const newAnswers = { ...answers, [q.id]: choice }
      setAnswers(newAnswers)
      setMessages((prev) => [...prev, { type: 'user', text: choice }])
      advanceOrComplete(newAnswers, currentStep + 1)
    },
    [answers, currentStep, template, advanceOrComplete]
  )

  const handleTextSubmit = useCallback(() => {
    const text = inputValue.trim()
    if (!text) return

    const q = template.questions[currentStep]
    const newAnswers = { ...answers, [q.id]: text }
    setAnswers(newAnswers)
    setMessages((prev) => [...prev, { type: 'user', text }])
    advanceOrComplete(newAnswers, currentStep + 1)
  }, [inputValue, answers, currentStep, template, advanceOrComplete])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleTextSubmit()
      }
    },
    [handleTextSubmit]
  )

  const currentQuestion = template.questions[currentStep]
  const isTextQuestion = currentQuestion?.type === 'text'

  return (
    <div className="launchpad" data-testid="launchpad-configure">
      <div className="launchpad__chat">
        {/* Header */}
        <div className="launchpad__chat-header">
          <button type="button" className="launchpad__back" onClick={onBack} title="Back to grid">
            &#x2190;
          </button>
          <div className="launchpad__chat-badge">
            <span className="launchpad__chat-badge-icon">{template.icon}</span>
            <span className="launchpad__chat-badge-name">{template.name}</span>
          </div>
          <span className="launchpad__chat-step">
            Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}
          </span>
        </div>

        {/* Messages */}
        <div className="launchpad__chat-messages">
          {messages.map((msg, i) =>
            msg.type === 'system' ? (
              <div key={i} className="launchpad__msg launchpad__msg--system">
                <div className="launchpad__msg-label">Agent Setup</div>
                {msg.text}
                {msg.choices && msg.questionId === currentQuestion?.id && (
                  <div className="launchpad__choices">
                    {msg.choices.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="launchpad__choice"
                        onClick={() => handleChoiceClick(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className="launchpad__msg launchpad__msg--user">
                {msg.text}
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="launchpad__chat-input-bar">
          <input
            ref={inputRef}
            className="launchpad__chat-input"
            placeholder={isTextQuestion ? 'Type an answer...' : 'Type an answer or pick above...'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="launchpad__chat-send"
            onClick={handleTextSubmit}
            disabled={!inputValue.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
