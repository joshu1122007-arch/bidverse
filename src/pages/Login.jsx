import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Gavel, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isConfigured } from '../lib/supabase';

export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, authError } = useAuth();
  const query = new URLSearchParams(location.search);
  const [mode, setMode] = useState(query.get('mode') === 'signup' ? 'signup' : 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const from = location.state?.from;
  const requestedPath = (typeof from === 'string' ? from : from?.pathname ? from.pathname + (from.search ?? '') : query.get('redirect')) ?? '/dashboard';
  const destination = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') && !/[\\\u0000-\u001f]/.test(requestedPath) && requestedPath.split(/[?#]/)[0] !== '/login' ? requestedPath : '/dashboard';

  useEffect(() => {
    setMode(new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login');
    const callback = new URLSearchParams(location.hash.slice(1));
    setError(callback.has('error') || callback.has('error_code') ? callback.get('error_description') || 'Your email confirmation link could not be accepted. Request a new link or try logging in.' : '');
    setSuccess('');
  }, [location.search, location.hash]);
  useEffect(() => {
    if (user && !loading) navigate(destination, { replace: true });
  }, [user, loading, destination, navigate]);

  const changeMode = (next) => {
    setMode(next);
    setError('');
    setSuccess('');
  };
  const submit = async (event) => {
    event.preventDefault();
    if (busy || !supabase) return;
    setError('');
    setSuccess('');
    if (!email.trim() || !password || (mode === 'signup' && password.length < 8)) {
      setError(mode === 'signup' ? 'Enter your email and a password with at least 8 characters.' : 'Enter your email and password.');
      return;
    }
    if (mode === 'signup' && (fullName.trim().length < 2 || fullName.trim().length > 60)) {
      setError('Enter your full name using 2 to 60 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(destination)}` },
        });
        if (signupError) throw signupError;
        if (data.session) navigate(destination, { replace: true });
        else {
          setSuccess('Check your email for a confirmation link. Verify your email, then log in to start bidding.');
          setPassword('');
          setMode('login');
        }
      } else {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (loginError) throw loginError;
        if (!data.session) throw new Error('Login could not be confirmed. Please try again.');
        navigate(destination, { replace: true });
      }
    } catch (failure) {
      setError(failure.message || 'Unable to connect. Please try again.');
    } finally { setBusy(false); }
  };

  return <div className="container page-shell auth-layout">
    <aside className="auth-aside">
      <span className="eyebrow"><Sparkles size={15} /> GOOD FINDS. GREAT POSSIBILITIES.</span>
      <h1>Your next great<br />find starts here<span className="accent-text">.</span></h1>
      <p>Join a community that sees the extraordinary in every item. Bid, sell, and discover something worth getting excited about.</p>
      <div className="auth-benefits"><p><Gavel size={21} /> A fair shot at something special</p><p><ShieldCheck size={21} /> Transparent bids, every step of the way</p></div>
      <div className="auth-art" aria-hidden="true"><Gavel size={80} strokeWidth={1.2} /><span>YOUR NEXT<br />GREAT FIND.</span></div>
    </aside>
    <section className="auth-card panel" aria-labelledby="auth-heading">
      <div className="auth-tabs" aria-label="Account action"><button type="button" className={mode === 'login' ? 'is-active' : ''} aria-pressed={mode === 'login'} onClick={() => changeMode('login')} disabled={busy}>Log in</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} aria-pressed={mode === 'signup'} onClick={() => changeMode('signup')} disabled={busy}>Create account</button></div>
      <h2 id="auth-heading">{mode === 'signup' ? 'Make yourself at home.' : 'Welcome back.'}</h2>
      <p className="muted">{mode === 'signup' ? 'A little curiosity goes a long way.' : 'Your next discovery is waiting for you.'}</p>
      {!isConfigured && <div className="config-banner" role="status">Account features are not connected yet. Add your Supabase URL and publishable key to .env, apply supabase/schema.sql, and restart the app. You can still <Link to="/explore">explore sample auctions</Link>.</div>}
      {authError && <p className="form-error" role="alert">{authError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status">{success}</p>}
      <form onSubmit={submit} aria-busy={busy}>
        {mode === 'signup' && <div className="form-field"><label htmlFor="full-name">Full name</label><input id="full-name" name="name" autoComplete="name" placeholder="Alex Morgan" minLength={2} maxLength={60} required value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={busy || !isConfigured} /></div>}
        <div className="form-field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy || !isConfigured} /></div>
        <div className="form-field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} minLength={mode === 'signup' ? 8 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || !isConfigured} />{mode === 'signup' && <span className="field-hint">Use at least 8 characters.</span>}</div>
        <button className="button button-primary" type="submit" disabled={busy || !isConfigured}>{busy ? 'Please wait...' : mode === 'signup' ? 'Create my account' : 'Log in'}<ArrowRight size={17} /></button>
      </form>
      <p className="auth-footnote"><ShieldCheck size={15} /> Your email stays private. Your great taste doesn't.</p>
    </section>
  </div>;
}
