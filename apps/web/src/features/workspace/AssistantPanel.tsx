import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyProposal,
  createConversation,
  listConversations,
  loadConversation,
  rejectProposal,
  sendConversationMessage,
  updateConversationScope,
  type ArtifactVersion,
  type ChangeSetRecord,
  type ConversationRecord,
  type MessageRecord,
  type ProjectBrief,
  type ProjectRecord,
} from "../../api/long-form.js";

const widthKey = "story-to-cyoa.assistant-width";
const clampWidth = (value: number) => Math.max(320, Math.min(620, value));

export function AssistantPanel(props: {
  project: ProjectRecord;
  brief: ArtifactVersion<ProjectBrief>;
  onBriefApplied(): Promise<void>;
}) {
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [proposals, setProposals] = useState<ChangeSetRecord[]>([]);
  const [content, setContent] = useState("");
  const [intent, setIntent] = useState<"discuss" | "propose">("discuss");
  const [model, setModel] = useState("openrouter/auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [width, setWidth] = useState(() => clampWidth(Number(localStorage.getItem(widthKey)) || 400));
  const historyRef = useRef<HTMLDivElement>(null);

  const refresh = async (conversationId: string) => {
    const state = await loadConversation(props.project.id, conversationId);
    setConversation(state.conversation);
    setMessages(state.messages);
    setProposals(state.proposals);
  };

  useEffect(() => {
    void (async () => {
      try {
        const existing = await listConversations(props.project.id);
        const selected = existing[0] ?? await createConversation(props.project.id);
        await refresh(selected.id);
      } catch (reason) {
        setError((reason as Error).message);
      }
    })();
  }, [props.project.id]);

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages, proposals]);

  const changeScope = async (kind: "project" | "artifact") => {
    if (!conversation) return;
    const scope = kind === "project"
      ? { kind: "project" as const, projectId: props.project.id }
      : {
          kind: "artifact" as const,
          projectId: props.project.id,
          stage: "brief" as const,
          artifactId: "brief" as const,
          versionId: props.brief.id,
        };
    try {
      setConversation(await updateConversationScope(props.project.id, conversation.id, scope));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  useEffect(() => {
    if (
      conversation?.scope.kind === "artifact"
      && conversation.scope.versionId !== props.brief.id
      && !busy
    ) {
      void changeScope("artifact");
    }
  }, [conversation?.scope.kind, conversation?.scope.versionId, props.brief.id, busy]);

  const send = async () => {
    if (!conversation || !content.trim()) return;
    setBusy(true);
    setError(null);
    setActivity(["Request sent"]);
    try {
      const result = await sendConversationMessage({
        projectId: props.project.id,
        conversationId: conversation.id,
        content,
        intent,
        model,
      });
      setContent("");
      setMessages((items) => [...items, result.userMessage, result.assistantMessage]);
      if (result.proposal) setProposals((items) => [...items, result.proposal!]);
      setActivity([
        ...result.activity.map((item) => item.kind.replaceAll("_", " ")),
        `${result.usage.totalTokens.toLocaleString()} tokens`,
        result.cost ? `$${result.cost.total.toFixed(4)}` : "Cost unavailable",
      ]);
    } catch (reason) {
      setError((reason as Error).message);
      await refresh(conversation.id);
    } finally {
      setBusy(false);
    }
  };

  const beginResize = (event: ReactPointerEvent) => {
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      const next = clampWidth(startWidth + startX - moveEvent.clientX);
      setWidth(next);
      localStorage.setItem(widthKey, String(next));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  if (collapsed) {
    return <aside className="assistant-panel collapsed">
      <button onClick={() => setCollapsed(false)} aria-label="Expand assistant">Chat</button>
    </aside>;
  }

  return <aside
    className={`assistant-panel ${fullScreen ? "full-screen" : ""}`}
    style={fullScreen ? undefined : { width }}
  >
    {!fullScreen && <div className="assistant-resize" onPointerDown={beginResize} aria-hidden="true" />}
    <header className="assistant-header">
      <div>
        <p className="eyebrow">Assistant</p>
        <h2>Project discussion</h2>
      </div>
      <div className="assistant-window-actions">
        <button onClick={() => setFullScreen((value) => !value)}>{fullScreen ? "Exit full screen" : "Full screen"}</button>
        <button onClick={() => {
          setFullScreen(false);
          setCollapsed(true);
        }}>Collapse</button>
      </div>
      <label>Scope
        <select
          value={conversation?.scope.kind ?? "artifact"}
          disabled={!conversation || busy}
          onChange={(event) => void changeScope(event.target.value as "project" | "artifact")}
        >
          <option value="artifact">Project brief · version {props.brief.version}</option>
          <option value="project">Whole project</option>
        </select>
      </label>
      <p className="scope-version">Project: {props.project.name} · Base: brief v{props.brief.version}</p>
    </header>

    <div className="assistant-history" ref={historyRef}>
      {messages.length === 0 && <p className="field-note">Ask questions freely, or choose “Propose change” when you want a reviewable edit to the brief.</p>}
      {messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}>
        <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
        <p>{message.content}</p>
        <small>{message.intent} · brief v{String(message.metadata.briefVersion ?? "?")}</small>
      </article>)}
      {proposals.map((proposal) => <ProposalCard
        key={proposal.id}
        proposal={proposal}
        currentBriefId={props.brief.id}
        busy={busy}
        onApply={async () => {
          if (!conversation) return;
          setBusy(true);
          setError(null);
          try {
            await applyProposal(props.project.id, conversation.id, proposal.id);
            await refresh(conversation.id);
            await props.onBriefApplied();
          } catch (reason) {
            setError((reason as Error).message);
            await refresh(conversation.id);
          } finally {
            setBusy(false);
          }
        }}
        onReject={async () => {
          if (!conversation) return;
          setBusy(true);
          try {
            await rejectProposal(props.project.id, conversation.id, proposal.id);
            await refresh(conversation.id);
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />)}
      {activity.length > 0 && <details className="provider-activity" open>
        <summary>Provider activity</summary>
        <div>{activity.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}</div>
      </details>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>

    <form className="assistant-composer" onSubmit={(event) => {
      event.preventDefault();
      void send();
    }}>
      <div className="assistant-compose-options">
        <label>Intent
          <select value={intent} onChange={(event) => setIntent(event.target.value as typeof intent)}>
            <option value="discuss">Discuss only</option>
            <option value="propose">Propose change</option>
          </select>
        </label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={intent === "discuss" ? "Ask about the project brief…" : "Describe the exact brief change you want…"}
      />
      <button className="primary" disabled={busy || !conversation || !content.trim()}>
        {busy ? "Working…" : intent === "discuss" ? "Send to assistant" : "Request proposal"}
      </button>
      <small>Sending calls the selected OpenRouter model. Discussion cannot edit artifacts; proposals require Apply changes.</small>
    </form>
  </aside>;
}

function ProposalCard(props: {
  proposal: ChangeSetRecord;
  currentBriefId: string;
  busy: boolean;
  onApply(): Promise<void>;
  onReject(): Promise<void>;
}) {
  const stale = props.proposal.status === "proposed" && props.proposal.baseVersionId !== props.currentBriefId;
  return <article className={`proposal-card ${props.proposal.status}`}>
    <header>
      <strong>Brief change proposal</strong>
      <span>{stale ? "outdated" : props.proposal.status}</span>
    </header>
    <h3>{props.proposal.summary}</h3>
    <p>{props.proposal.rationale}</p>
    <p className="field-note">Applying creates a new draft version; it does not approve the brief.</p>
    <details>
      <summary>Review candidate brief</summary>
      <dl className="proposal-preview">
        <dt>Working title</dt><dd>{props.proposal.candidate.workingTitle}</dd>
        <dt>Total words</dt><dd>{props.proposal.candidate.totalWordTarget.toLocaleString()}</dd>
        <dt>Routes</dt><dd>{props.proposal.candidate.routeTarget}</dd>
        <dt>Endings</dt><dd>{props.proposal.candidate.endingTarget}</dd>
        <dt>Premise</dt><dd>{props.proposal.candidate.premise || "Not set"}</dd>
      </dl>
    </details>
    {props.proposal.status === "proposed" && <div className="proposal-actions">
      <button disabled={props.busy} onClick={() => void props.onReject()}>Reject</button>
      <button className="primary" disabled={props.busy || stale} onClick={() => void props.onApply()}>Apply changes</button>
    </div>}
  </article>;
}
