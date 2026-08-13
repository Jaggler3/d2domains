const counters = new Map<string, number>();

export function recordMetric(route: string, status: number): void {
  const key = `${route}|${status}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function renderMetrics(): string {
  const lines = [
    "# HELP hog_requests_total Requests by route and status",
    "# TYPE hog_requests_total counter",
  ];
  for (const [key, count] of counters) {
    const [route, status] = key.split("|");
    const safeRoute = (route ?? "").replace(/"/g, '\\"');
    lines.push(`hog_requests_total{route="${safeRoute}",status="${status ?? ""}"} ${count}`);
  }
  return lines.join("\n") + "\n";
}
