export interface CostDashboardRoute {
  model: string;
  p95Ms?: number;
  p95Usd?: number;
  passRate?: number;
}

export function CostDashboard({ routes }: { routes: CostDashboardRoute[] }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      {routes.map((route) => (
        <div key={route.model} style={{ border: "1px solid rgba(148,163,184,.28)", borderRadius: 12, padding: 12 }}>
          <strong>{route.model}</strong>
          <div>p95: {route.p95Ms ? `${route.p95Ms}ms` : "—"}</div>
          <div>cost: {route.p95Usd !== undefined ? `$${route.p95Usd.toFixed(3)}` : "—"}</div>
          <div>pass: {route.passRate !== undefined ? `${Math.round(route.passRate * 100)}%` : "—"}</div>
        </div>
      ))}
    </section>
  );
}


