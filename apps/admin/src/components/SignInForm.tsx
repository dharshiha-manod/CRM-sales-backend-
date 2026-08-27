import { FormEvent, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type SignInFormProps = { client: SupabaseClient; onSignedIn: () => Promise<void> };

export function SignInForm({ client, onSignedIn }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    await onSignedIn();
    setLoading(false);
  }

  return <section className="auth-card"><h2>Sign in</h2><p>Use your Field Sales administrator account.</p><form className="auth-form" onSubmit={submit}><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="error" role="alert">{error}</p>}<button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button></form></section>;
}
