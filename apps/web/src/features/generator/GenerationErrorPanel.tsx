import { useState } from "react";
import type { GenerationDiagnostic, PublicGenerationError } from "../../api/quick-generation.js";

export interface GenerationErrorPanelProps {
  error: PublicGenerationError & { diagnosticId?: string };
  loadDiagnostic(id: string): Promise<GenerationDiagnostic>;
  onRetry(): void;
  onChangeModel(): void;
}

export function GenerationErrorPanel({ error, loadDiagnostic, onRetry, onChangeModel }: GenerationErrorPanelProps) {
  const [diagnostic, setDiagnostic] = useState<GenerationDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const showDiagnostic = async () => {
    if (!error.diagnosticId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setDiagnostic(await loadDiagnostic(error.diagnosticId));
    } catch {
      setLoadError("Could not load the retained diagnostic.");
    } finally {
      setLoading(false);
    }
  };

  const serializedDiagnostic = diagnostic ? JSON.stringify(browserSafeDiagnostic(diagnostic), null, 2) : "";
  const confirmSourceAction = (): boolean => !diagnostic?.containsSourceText || window.confirm("This diagnostic may contain submitted source text. Continue?");
  const copy = async () => {
    if (!diagnostic || !confirmSourceAction()) return;
    await navigator.clipboard?.writeText(serializedDiagnostic);
  };
  const download = () => {
    if (!diagnostic || !confirmSourceAction()) return;
    const url = URL.createObjectURL(new Blob([serializedDiagnostic], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "generation-diagnostic.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="generation-error" role="alert" aria-label="Generation error">
    <p>{error.message}</p>
    <div className="row">
      {error.retryable && <button type="button" onClick={onRetry}>Retry</button>}
      <button type="button" onClick={onChangeModel}>Try another model</button>
      {error.diagnosticId && <button type="button" onClick={() => void showDiagnostic()} disabled={loading}>
        {loading ? "Loading response…" : "View full response"}
      </button>}
    </div>
    {loadError && <p>{loadError}</p>}
    {diagnostic && <div className="diagnostic">
      {diagnostic.containsSourceText && <p className="warning">The response may contain submitted source text.</p>}
      <p>Response: {diagnostic.status ?? "unknown"}{diagnostic.contentType ? ` · ${diagnostic.contentType}` : ""}{diagnostic.requestId ? ` · Request ${diagnostic.requestId}` : ""}</p>
      <p>{diagnostic.body.originalBytes.toLocaleString()} bytes{diagnostic.body.truncated ? " (truncated)" : ""}</p>
      <pre>{diagnostic.body.text}</pre>
      <div className="row">
        <button type="button" onClick={() => void copy()}>Copy diagnostics</button>
        <button type="button" onClick={download}>Download full response</button>
      </div>
    </div>}
  </section>;
}

function browserSafeDiagnostic(diagnostic: GenerationDiagnostic): GenerationDiagnostic {
  return {
    containsSourceText: diagnostic.containsSourceText,
    status: diagnostic.status,
    contentType: diagnostic.contentType,
    requestId: diagnostic.requestId,
    body: diagnostic.body,
  };
}
