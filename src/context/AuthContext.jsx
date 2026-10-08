import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({ user: null, loading: true, authError: '' });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    let receivedAuthEvent = false;
    const timeout = setTimeout(() => {
      if (!mounted) return;
      setLoading(false);
      setAuthError('Your session could not be checked. Refresh the page or try logging in again.');
    }, 12000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      if (!mounted) return;
      clearTimeout(timeout);
      setUser(session?.user ?? null);
      setLoading(false);
      setAuthError('');
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted || receivedAuthEvent) return;
      if (error) throw error;
      setUser(data.session?.user ?? null);
    }).catch(() => {
      if (mounted && !receivedAuthEvent) setAuthError('Your session could not be checked. Try logging in again.');
    }).finally(() => {
      clearTimeout(timeout);
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading, authError }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
