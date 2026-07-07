// Pure presentational Discord-embed-style preview. Server-renderable.
import { InternalLabelBadge } from '@/components/ui';
import {
  buildDiscordPreview,
  formatSelectionLine,
  type DiscordPreviewSource,
} from '@/lib/discord-preview-model';

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8e9297]">{label}</span>
      {value ? (
        <span className="text-sm text-[#dcddde]">{value}</span>
      ) : (
        <InternalLabelBadge label="Data Missing" />
      )}
    </div>
  );
}

export function DiscordEmbedPreview({ source }: { source: DiscordPreviewSource }) {
  const p = buildDiscordPreview(source);

  return (
    <div className="max-w-xl">
      {/* Discord dark message surface */}
      <div className="rounded-lg bg-[#313338] p-4">
        <div
          className="rounded-[4px] bg-[#2b2d31] p-4"
          style={{ borderLeft: `4px solid ${p.accentColor}` }}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold text-white">{p.title}</h3>
            {p.tierDestination ? (
              <span
                className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{ color: p.accentColor, border: `1px solid ${p.accentColor}` }}
              >
                {p.tierDestination}
              </span>
            ) : null}
          </div>

          {p.sport || p.eventStartTime ? (
            <p className="mt-1 text-xs text-[#8e9297]">
              {[p.sport, p.eventStartTime ? new Date(p.eventStartTime).toLocaleString() : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <FieldRow label="Market" value={p.market} />
            <FieldRow
              label="Pick"
              value={p.selection || p.line !== null || p.odds !== null
                ? formatSelectionLine(p.selection, p.line, p.odds)
                : null}
            />
            <FieldRow label="Book" value={p.book} />
            <FieldRow label="Risk" value={p.riskRating ? `${p.riskRating.toUpperCase()} risk` : null} />
          </div>

          <div className="mt-3">
            <FieldRow label="Reasoning" value={p.reasoning} />
          </div>

          <div className="mt-4 border-t border-[#3f4147] pt-2 text-[11px] text-[#8e9297]">
            {p.footer}
          </div>
        </div>
      </div>

      {p.missing.length > 0 ? (
        <p className="mt-2 text-xs cc-text-muted">
          Missing before dispatch: {p.missing.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
