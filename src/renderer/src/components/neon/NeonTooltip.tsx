// src/renderer/src/components/neon/NeonTooltip.tsx
import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface NeonTooltipProps {
  label: string;
  shortcut?: string;
  delay?: number;
  children: ReactNode;
}

export function NeonTooltip({ label, shortcut, delay = 300, children }: NeonTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);


  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top + rect.height / 2 - 14,
          left: rect.right + 8,
        });
      }
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            className="neon-tooltip"
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {label}
            {shortcut && <span className="neon-tooltip__shortcut">{shortcut}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
