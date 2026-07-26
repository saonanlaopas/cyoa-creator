export type JobEvent = { jobId: string; progress: number; status: string };
export function subscribeToJob(jobId: string, receive: (event: JobEvent) => void): () => void { if (typeof EventSource === "undefined") return () => {}; const source = new EventSource(`/api/jobs/${jobId}/events`); source.onmessage = ({ data }) => receive(JSON.parse(data) as JobEvent); return () => source.close(); }
