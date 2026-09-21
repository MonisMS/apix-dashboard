import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * AskAI's mark: a squircle with eyes that track the cursor, blink on an idle
 * timer, wink on hover, and scan side-to-side while a question is in flight.
 * Colors are `currentColor`/CSS vars, not hardcoded, so light/dark just work.
 */
export function CopilotIcon({ size = 20, thinking = false, className = '' }) {
  const svgRef = useRef(null);
  const [eyePos, setEyePos] = useState({ x: 0, y: 0 });
  const rafRef = useRef(null);

  useEffect(() => {
    if (thinking) return undefined;
    const handleMouseMove = (e) => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist === 0) {
          setEyePos({ x: 0, y: 0 });
          return;
        }
        const angle = Math.atan2(dy, dx);
        const intensity = Math.min(dist / 60, 1);
        setEyePos({
          x: Math.round(Math.cos(angle) * 1.8 * intensity * 100) / 100,
          y: Math.round(Math.sin(angle) * 1.8 * intensity * 100) / 100,
        });
      });
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [thinking]);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('copilot-icon-svg', thinking && 'is-thinking', className)}
      aria-hidden="true"
      style={{ flexShrink: 0, overflow: 'visible' }}
    >
      <rect width="24" height="24" rx="7" className="copilot-icon-body" />
      <g
        className={cn('copilot-icon-eyes', thinking && 'is-scanning')}
        style={
          thinking
            ? undefined
            : { transform: `translate(${eyePos.x}px, ${eyePos.y}px)`, transition: 'transform 0.08s ease-out' }
        }
      >
        <rect x="7.1" y="7.8" width="3.4" height="8.4" rx="1.7" className="copilot-icon-eye" />
        <rect x="13.5" y="7.8" width="3.4" height="8.4" rx="1.7" className="copilot-icon-eye copilot-icon-eye-right" />
      </g>
    </svg>
  );
}
