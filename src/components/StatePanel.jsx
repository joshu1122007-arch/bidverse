import { LoaderCircle, SearchX } from 'lucide-react';

export default function StatePanel({ title, message, children, loading = false }) {
  return <div className={loading ? 'empty-state loading-state' : 'empty-state'} role={loading ? 'status' : undefined}>
    <div className="state-icon">{loading ? <LoaderCircle className="spin" size={28} /> : <SearchX size={28} />}</div>
    <h2>{title || (loading ? 'Finding your next great find…' : 'Nothing here just yet')}</h2>
    {message && <p>{message}</p>}{children}
  </div>;
}
