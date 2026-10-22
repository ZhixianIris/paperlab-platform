/**
 * Dependency-free adaptation of the ChatLayout interaction model from
 * @ant-design/agentic-ui (MIT, commit 685f0a4bc14e2ef1a736a678eedd9fdc2a7a5f95):
 * a scrollable message region, a fixed composer region and a welcome slot.
 * We keep PaperLab's React 18/Vite bundle instead of pulling in antd + React 19
 * peers. See third_party/agentic-ui/SOURCE.md.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function ChatLayout({
  children,
  footer,
  className = '',
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    if (nearBottom) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [children]);

  return (
    <div className={`chat-layout ${className}`}>
      <div className="chat-layout-scroll" ref={scrollRef}>
        {children}
      </div>
      {footer ? <div className="chat-layout-footer">{footer}</div> : null}
    </div>
  );
}

export function WelcomeMessage({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="welcome-message">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  );
}
