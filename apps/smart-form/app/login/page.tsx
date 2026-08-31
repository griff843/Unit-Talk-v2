'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { setStoredToken } from '@/lib/auth-token';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState(false);

  function handleTokenChange(value: string) {
    setToken(value);
    setError(null);
  }

  // UTV2-1786: a recovery token is stored so the API can authenticate the
  // bearer, but it does NOT grant access to /submit. Its signature cannot be
  // verified in the browser, so a decoded payload is an unauthenticated claim,
  // not an identity. Access is granted only by an Auth.js session, which the
  // server signs and /submit waits for.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Paste the full token you received from your operator.');
      return;
    }
    setStoredToken(trimmed);
    setStored(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-muted-foreground">Unit Talk</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">Capper Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with an approved capper account to open the Smart Form.
          </p>
        </div>

        <Button
          type="button"
          className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-5"
          onClick={() => void signIn('google', { callbackUrl: '/submit' })}
        >
          Continue with Google
        </Button>

        <p className="text-center text-xs text-muted-foreground">Only allowlisted Google accounts can continue.</p>

        <details className="rounded-lg border border-border bg-background px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Operator recovery access
          </summary>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="token" className="text-sm font-medium text-foreground">
              Operator-issued recovery token
            </label>
            <Input
              id="token"
              type="password"
              placeholder="eyJ..."
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Storing a recovery token lets the API authenticate your requests. It does not
            sign you in: the token&apos;s signature cannot be checked in the browser, so it is
            never treated as proof of identity here. Continue with Google to open the form.
          </p>

          {stored && (
            <div
              data-testid="recovery-token-stored"
              className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Token stored
              </p>
              <p className="text-sm text-foreground">
                Saved for API requests. Sign in with Google to open the Smart Form.
              </p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-5"
            disabled={!token.trim()}
          >
            Store recovery token
          </Button>
          </form>
        </details>
      </div>
    </main>
  );
}
