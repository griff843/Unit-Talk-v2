'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredCapperClaims } from '@/lib/auth-token';
import { BetForm } from './components/BetForm';

export default function SubmitPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const claims = getStoredCapperClaims();
    if (!claims) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  return <BetForm />;
}
