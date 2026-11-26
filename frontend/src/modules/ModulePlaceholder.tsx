export function ModulePlaceholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">
        Scaffold ready. Full CRUD workflows will be implemented in {milestone}.
      </p>
    </div>
  )
}
