import { useState, KeyboardEvent } from 'react'
import { TagBadge } from './TagBadge'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string | undefined
  maxTags?: number | undefined
}

export function TagInput({
  tags,
  onChange,
  placeholder = 'Add tag...',
  maxTags
}: TagInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      const newTag = inputValue.trim()

      // Don't add duplicates
      if (tags.includes(newTag)) {
        setInputValue('')
        return
      }

      // Check max tags limit
      if (maxTags && tags.length >= maxTags) {
        setInputValue('')
        return
      }

      onChange([...tags, newTag])
      setInputValue('')
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // Remove last tag on backspace when input is empty
      onChange(tags.slice(0, -1))
    }
  }

  const removeTag = (index: number): void => {
    onChange(tags.filter((_, i) => i !== index))
  }

  return (
    <div className="tag-input">
      <div className="tag-input__tags">
        {tags.map((tag, index) => (
          <TagBadge key={`${tag}-${index}`} tag={tag} onRemove={() => removeTag(index)} />
        ))}
      </div>
      <input
        type="text"
        className="tag-input__field"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ''}
        disabled={maxTags !== undefined && tags.length >= maxTags}
        aria-label="Add tag"
      />
    </div>
  )
}
