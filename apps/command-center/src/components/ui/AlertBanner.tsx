export type AlertBannerTone = 'info' | 'warning' | 'critical' | 'success';

const tones: Record<AlertBannerTone, string> = {
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  warning: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  critical: 'border-red-500/40 bg-red-500/10 text-red-200',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

export function AlertBanner({
  tone,
  title,
  children,
}: {
  tone: AlertBannerTone;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      <span className="font-semibold">{title}</span>
      {children && <div className="mt-1 text-xs opacity-90">{children}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Load Failed', detail }: { title?: string; detail?: string }) {
  return (
    <div className="cc-surface p-5">
      <div className="text-sm font-semibold uppercase tracking-wide text-red-400">{title}</div>
      {detail && <p className="cc-text-secondary mt-2 text-sm">{detail}</p>}
      <p className="cc-text-muted mt-2 text-xs">Retry by refreshing. If this persists, check the Fire Board.</p>
    </div>
  );
}
