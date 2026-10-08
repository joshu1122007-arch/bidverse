import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, X, LogOut, Gavel } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';

export function Brand({ light = false }) {
  return <Link to="/" className={`brand${light ? ' brand-light' : ''}`} aria-label="BidVerse home"><span className="brand-icon"><Gavel size={22} strokeWidth={2.1} /></span><span>Bid<span className="brand-blue">Verse</span><span className="brand-dot">.</span></span></Link>;
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user, loading } = useAuth();
  const notify = useToast();
  const location = useLocation();
  const logout = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      notify('You have been logged out.');
      setOpen(false);
    } catch (error) { notify(error.message || 'Unable to log out. Try again.', 'error'); }
    finally { setBusy(false); }
  };
  return <header className="site-header"><div className="container nav-inner">
    <Brand />
    <button className="menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    <nav id="main-navigation" className={`main-nav ${open ? 'is-open' : ''}`} aria-label="Main navigation">
      <div className="nav-links">{[['/', 'Home'], ['/explore', 'Explore Auctions'], ['/create', 'Sell Product'], ['/dashboard', 'Dashboard']].map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>{label}</NavLink>)}</div>
      <div className="nav-actions">{loading ? <span className="muted">Loading…</span> : user ? <button className="button button-secondary button-sm" disabled={busy} onClick={logout}><LogOut size={16} />{busy ? 'Logging out…' : 'Log out'}</button> : <Link className="login-link" to="/login" state={{ from: location }} onClick={() => setOpen(false)}>Log in</Link>}
        <Link className="button button-primary button-sm" to={user ? '/create' : '/login?mode=signup'} onClick={() => setOpen(false)}>{user ? 'Create auction' : 'Get started'}<ArrowUpRight size={16} /></Link>
      </div>
    </nav>
  </div></header>;
}
