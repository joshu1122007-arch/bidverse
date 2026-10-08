import { createContext, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (message, type = 'success') => setToast({ message, type });
  return <ToastContext.Provider value={notify}>
    {children}
    {toast && <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
      {toast.type === 'error' ? <AlertCircle size={21} /> : <CheckCircle2 size={21} />}
      <span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={18} /></button>
    </div>}
  </ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
