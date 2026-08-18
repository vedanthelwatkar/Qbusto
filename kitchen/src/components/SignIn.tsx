import { useState } from 'react';
import type { FormEvent } from 'react';

import { useAuthStore } from '../stores/auth.store';

/**
 * Sign-in for a kitchen terminal.
 *
 * A real staff account, not a shared kiosk key: every request the KDS makes is
 * authorised against that account's Orders permission, and every status change
 * is recorded against that user in order_status_logs. A wall display that
 * cannot say who marked an order delivered is not much of an audit trail.
 */
export function SignIn() {
  const signIn = useAuthStore((state) => state.signIn);
  const signingIn = useAuthStore((state) => state.signingIn);
  const error = useAuthStore((state) => state.error);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0 && !signingIn;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void signIn(username.trim(), password);
  };

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={onSubmit}>
        <div className="signin__brand">
          <span className="signin__mark" aria-hidden="true">
            Q
          </span>
          <h1 className="signin__title">
            QBusto <span>Kitchen Display</span>
          </h1>
        </div>

        <label className="signin__field">
          <span className="signin__label">Username</span>
          <input
            className="signin__input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="signin__field">
          <span className="signin__label">Password</span>
          <input
            className="signin__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {/*
          role="alert" so the failure is announced. The message comes from the
          backend, which deliberately does not say whether it was the username
          or the password that was wrong.
        */}
        {error && (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="signin__submit" disabled={!canSubmit}>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
