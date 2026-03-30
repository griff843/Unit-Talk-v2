export default function PickDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold">Pick Detail</h1>
      <p className="font-mono text-sm text-gray-400">{params.id}</p>
      <p className="text-sm text-gray-500">Full lifecycle trace coming in next PR.</p>
    </div>
  );
}
