import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isConfigured } from '../lib/supabase';
import StatePanel from './StatePanel';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="container page-shell"><StatePanel loading title="Checking your account..." /></div>;
  if (!isConfigured) return <div className="container page-shell"><StatePanel title="Connect Supabase to continue" message="Account features need a Supabase project. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env, apply supabase/schema.sql, and restart the app."><Link to="/explore" className="button button-primary">Explore sample auctions</Link></StatePanel></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children ?? <Outlet />;
}
