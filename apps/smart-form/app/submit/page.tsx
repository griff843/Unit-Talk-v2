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
  const { status } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (qaAuthBypassEnabled) {
      setReady(true);
      return;
    }

    if (status === 'authenticated') {
      setReady(true);
      return;
    }

    if (status === 'loading') {
      return;
    }

    const claims = getStoredCapperClaims();
    if (!claims) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router, status]);

  if (!ready) return null;
  return <BetForm />;
}
