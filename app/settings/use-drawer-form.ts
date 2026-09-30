"use client";
import { useCallback, useState } from 'react';
import type { Row } from '../ui-types';

/** Form state for a master-data drawer: open with a record, edit, submit, and keep the server's refusal visible. */
export function useDrawerForm() {
  const [form, setForm] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = useCallback((row: Row) => { setError(''); setForm(row); }, []);
  const close = useCallback(() => { setForm(null); setError(''); }, []);
  const change = useCallback((patch: Row) => setForm(old => (old ? { ...old, ...patch } : old)), []);
  const submit = useCallback(async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); setForm(null); } catch (reason) { if ((reason as Error)?.name === 'ReviewPending') return; setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  }, []);
  return { form, busy, error, open, close, change, submit };
}
