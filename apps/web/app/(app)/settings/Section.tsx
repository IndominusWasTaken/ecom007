export function Section({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

/** Time zone suggestions for inputs (list="tz-list"). */
export function TimeZoneList() {
  return (
    <datalist id="tz-list">
      {Intl.supportedValuesOf("timeZone").map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
