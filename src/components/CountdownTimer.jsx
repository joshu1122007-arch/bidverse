import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';

export default function CountdownTimer({ endTime, onExpire, compact = false }) {
  const [now, setNow] = useState(Date.now);
  const expireCallback = useRef(onExpire);
  const notifiedDeadline = useRef(null);
  expireCallback.current = onExpire;
  const deadline = new Date(endTime).getTime();

  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline && notifiedDeadline.current !== deadline) {
        notifiedDeadline.current = deadline;
        expireCallback.current?.();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!Number.isFinite(deadline)) return <span className="muted">Deadline unavailable</span>;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const label = seconds === 0
    ? 'Auction ended'
    : `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m${compact && days ? '' : ` ${String(remainder).padStart(2, '0')}s`}`;

  return (
    <span className={`countdown${compact ? ' countdown-compact' : ''}${seconds === 0 ? ' countdown-ended' : ''}`} role="timer" aria-label={label} title={new Date(deadline).toLocaleString('en-IN')}>
      <Clock3 size={compact ? 14 : 17} aria-hidden="true" />
      {label}
    </span>
  );
}
