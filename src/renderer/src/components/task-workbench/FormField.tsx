import type { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  htmlFor: string
  className?: string | undefined
  children: ReactNode
}

/**
 * Reusable form field wrapper providing consistent label + input layout.
 * Ensures accessibility via proper label-for-id linking.
 */
export function FormField({
  label,
  htmlFor,
  className = 'wb-form__field',
  children
}: FormFieldProps): React.JSX.Element {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="wb-form__label">
        {label}
      </label>
      {children}
    </div>
  )
}
