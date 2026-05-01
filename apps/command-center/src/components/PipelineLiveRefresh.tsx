'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

import type { PipelineLiveConfig } from '@/lib/pipeline-health';

interface PipelineLiveRefreshProps {
  config: PipelineLiveConfig | null;
}

export function PipelineLiveRefresh({ config }: PipelineLiveRefreshProps) {
  const router = useRouter();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!config) return;

    const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const channel = client.channel('command-center-pipeline-live');
    for (const table of config.tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = window.setTimeout(() => {
            router.refresh();
          }, 250);
        },
      );
    }

    channel.subscribe();

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      void client.removeChannel(channel);
    };
  }, [config, router]);

  return null;
}
