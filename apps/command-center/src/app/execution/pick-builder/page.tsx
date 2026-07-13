import { PickBuilderForm } from '@/components/PickBuilderForm';

export const metadata = { title: 'Pick Builder — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

export default function PickBuilderPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-secondary">
          Compose a Unit Talk pick and submit it into the governed pipeline. Submissions land in the
          review queue — nothing here posts directly to members.
        </p>
        <p className="text-xs cc-text-muted">Internal operator tool. Rendered {new Date().toISOString()}.</p>
      </div>

      <PickBuilderForm />
    </div>
  );
}
