import { IntelligenceWorkspaceNav } from '@/components/IntelligenceWorkspaceNav';

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <IntelligenceWorkspaceNav />
      {children}
    </div>
  );
}
