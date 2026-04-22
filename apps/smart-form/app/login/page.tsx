'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { decodeCapperToken, setStoredToken } from '@/lib/auth-token';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ capperId: string; displayName: string } | null>(null);

  function handleTokenChange(value: string) {
    setToken(value);
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    const claims = decodeCapperToken(trimmed);
    if (claims) {
      setPreview({ capperId: claims.capperId, displayName: claims.displayName });
    } else {
      setPreview(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    const claims = decodeCapperToken(trimmed);
    if (!claims) {
      setError('Invalid capper token. Paste the full token you received from your operator.');
      return;
    }
    setStoredToken(trimmed);
    router.push('/submit');
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Capper Login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your approved Google account or paste your capper token.
          </p>
        </div>

        <Button
          type="button"
          className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-5"
          onClick={() => void signIn('google', { callbackUrl: '/submit' })}
        >
          Sign in with Google
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-semibold uppercase text-muted-foreground">Fallback token</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="token" className="text-sm font-medium text-foreground">
              Capper Token
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

          {preview && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Token recognized
              </p>
              <p className="text-sm font-semibold text-foreground">{preview.displayName}</p>
              <p className="text-xs text-muted-foreground">{preview.capperId}</p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-5"
            disabled={!token.trim()}
          >
            Enter
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center">
          Don&apos;t have a token? Contact your operator to get one issued.
        </p>
      </div>
    </main>
  );
}
