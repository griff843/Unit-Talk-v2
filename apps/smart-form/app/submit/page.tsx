'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { isQaAuthBypassEnabled } from '@/lib/auth-config';
import { getStoredCapperClaims } from '@/lib/auth-token';
import { BetForm } from './components/BetForm';

const qaAuthBypassEnabled = isQaAuthBypassEnabled();

export default function SubmitPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (qaAuthBypassEnabled) {
      setReady(true);
      return;
    }

    // UTV2-1786: /submit must wait for authoritative session resolution before
    // making any access decision. `status` is 'loading' until Auth.js has
    // resolved the server-signed session, and a decision taken during that
    // window can only be based on client-held state.
    if (status === 'loading') {
      return;
    }

    if (status === 'authenticated') {
      setReady(true);
      return;
    }

    // A capper token in localStorage is NOT authority. `getStoredCapperClaims`
    // base64-decodes the payload without verifying the signature, so anyone can
    // forge one; identity is derived server-side from the bearer on every
    // request. The stored token is carried into API calls so an operator-issued
    // recovery token still works, but the API — not this component — decides
    // whether it is valid, and a forged token yields a 401 rather than a
    // usable session.
    router.replace('/login');
  }, [router, status]);

  if (!ready) return null;

  const storedClaims = typeof window === 'undefined' ? null : getStoredCapperClaims();

  return (
    <BetForm
      authenticatedCapper={session?.capperId ? {
        capperId: session.capperId,
        displayName: session.user?.name ?? session.capperId,
      } : storedClaims?.capperId ? {
        capperId: storedClaims.capperId,
        displayName: storedClaims.displayName ?? storedClaims.capperId,
      } : null}
    />
  );
}
