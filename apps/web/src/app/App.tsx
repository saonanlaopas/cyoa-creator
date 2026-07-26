import { useEffect, useState } from "react";

type HealthState = "checking" | "ready" | "unavailable";

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.ok && response.json())
      .then((payload) => setHealth(payload?.ok ? "ready" : "unavailable"))
      .catch(() => setHealth("unavailable"));
  }, []);

  return (
    <main>
      <p className="eyebrow">Story to CYOA</p>
      <h1>Create project</h1>
      <p>Start a local, branching story project.</p>
      <p aria-live="polite" className={`health health--${health}`}>
        Service {health === "checking" ? "is checking" : health}
      </p>
    </main>
  );
}
