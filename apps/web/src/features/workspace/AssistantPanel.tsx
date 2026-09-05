import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyProposal,
  createPinnedDecision,
  createConversation,
  listAssistantSections,
  listConversations,
  loadAuthorMemoryContext,
  loadConversation,
  rejectProposal,
  sendConversationMessage,
  updatePinnedDecision,
  updateConversationScope,
  type ArtifactVersion,
  type AuthorMemoryContext,
  type ChangeSetRecord,
  type ConversationRecord,
  type LongFormStoryBible,
  type LongFormRoutePlan,
  type LongFormEndingPlan,
  type LongFormMechanicsPlan,
  type MessageRecord,
  type ProjectBrief,
  type ProjectRecord,
} from "../../api/long-form.js";

const widthKey = "story-to-cyoa.assistant-width";
const clampWidth = (value: number) => Math.max(320, Math.min(620, value));

export function AssistantPanel(props: {
  project: ProjectRecord;
  brief: ArtifactVersion<ProjectBrief>;
  bible: ArtifactVersion<LongFormStoryBible> | null;
  routes: ArtifactVersion<LongFormRoutePlan> | null;
  endings: ArtifactVersion<LongFormEndingPlan> | null;
  mechanics: ArtifactVersion<LongFormMechanicsPlan> | null;
  activeArtifact: "brief" | "bible" | "routes" | "endings" | "mechanics";
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
  const [memory, setMemory] = useState<AuthorMemoryContext | null>(null);
  const [decisionContent, setDecisionContent] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(80);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [width, setWidth] = useState(() => clampWidth(Number(localStorage.getItem(widthKey)) || 400));
  const historyRef = useRef<HTMLDivElement>(null);

  const refresh = async (conversationId: string) => {
    const state = await loadConversation(props.project.id, conversationId);
    setConversation(state.conversation);
    setMessages(state.messages);
    setProposals(state.proposals);
    setHistoryNotice(state.messagesTruncated || state.proposalsTruncated
      ? `Showing the newest ${state.messages.length} of ${state.messageCount ?? state.messages.length} messages and ${state.proposals.length} of ${state.proposalCount ?? state.proposals.length} proposals.`
      : null);
    setMemory(await loadAuthorMemoryContext(props.project.id, conversationId, state.conversation.scope));
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

  const artifactFor = (selection: "brief" | "bible" | "routes" | "endings" | "mechanics") =>
    selection === "mechanics" ? props.mechanics : selection === "endings"
      ? props.endings
      : selection === "routes"
        ? props.routes
        : selection === "bible"
          ? props.bible
          : props.brief;

  const changeScope = async (
    selection: "project" | "brief" | "bible" | "routes" | "endings" | "mechanics",
    sectionId = "root",
  ) => {
    if (!conversation) return;
    const selected = selection === "project" ? null : artifactFor(selection);
    if (selection !== "project" && !selected) return;
    const scope = selection === "project"
      ? { kind: "project" as const, projectId: props.project.id }
      : {
          kind: "artifact" as const,
          projectId: props.project.id,
          stage: selection,
          artifactId: selection,
          versionId: selected!.id,
          sectionId,
        };
    try {
      setConversation(await updateConversationScope(props.project.id, conversation.id, scope));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  useEffect(() => {
    const artifactId = conversation?.scope.kind === "artifact" ? conversation.scope.artifactId : undefined;
    if (!artifactId) {
      setSections([]);
      return;
    }
    void listAssistantSections(props.project.id, artifactId)
      .then(setSections)
      .catch((reason: Error) => setError(reason.message));
  }, [props.project.id, conversation?.scope.kind, conversation?.scope.artifactId, conversation?.scope.versionId]);

  useEffect(() => {
    const selected = artifactFor(props.activeArtifact);
    if (!conversation || busy) return;
    if (!selected) {
      if (conversation.scope.kind !== "project") void changeScope("project");
      return;
    }
    if (
      conversation.scope.kind !== "artifact"
      || conversation.scope.artifactId !== props.activeArtifact
      || conversation.scope.versionId !== selected.id
    ) void changeScope(props.activeArtifact);
  }, [
    conversation?.scope.kind,
    conversation?.scope.artifactId,
    conversation?.scope.versionId,
    props.activeArtifact,
    props.brief.id,
    props.bible?.id,
    props.routes?.id,
    props.endings?.id,
    props.mechanics?.id,
    busy,
  ]);

  useEffect(() => {
    if (!conversation) return;
    void loadAuthorMemoryContext(props.project.id, conversation.id, conversation.scope)
      .then(setMemory).catch((reason: Error) => setError(reason.message));
  }, [props.project.id, conversation?.id, conversation?.scope.kind, conversation?.scope.artifactId,
    conversation?.scope.versionId, conversation?.scope.sectionId]);

  const currentArtifact = artifactFor(props.activeArtifact);
  const artifactLabel = props.activeArtifact === "mechanics"
    ? "mechanics plan"
    : props.activeArtifact === "endings"
      ? "ending architecture"
      : props.activeArtifact === "routes"
        ? "route architecture"
        : props.activeArtifact === "bible"
          ? "story bible"
          : "project brief";

  useEffect(() => {
    if (conversation?.scope.kind === "project" && intent === "propose") setIntent("discuss");
  }, [conversation?.scope.kind, intent]);

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
      setMemory(await loadAuthorMemoryContext(props.project.id, conversation.id, conversation.scope));
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
          value={conversation?.scope.kind === "project" ? "project" : conversation?.scope.artifactId ?? props.activeArtifact}
          disabled={!conversation || busy}
          onChange={(event) => void changeScope(event.target.value as "project" | "brief" | "bible" | "routes" | "endings" | "mechanics")}
        >
          <option value="brief">Project brief · version {props.brief.version}</option>
          {props.bible && <option value="bible">Story bible · version {props.bible.version}</option>}
          {props.routes && <option value="routes">Route architecture · version {props.routes.version}</option>}
          {props.endings && <option value="endings">Ending architecture · version {props.endings.version}</option>}
          {props.mechanics && <option value="mechanics">Mechanics · version {props.mechanics.version}</option>}
          <option value="project">Whole project</option>
        </select>
      </label>
      {conversation?.scope.kind === "artifact" && <label>Section
        <select
          value={conversation.scope.sectionId ?? "root"}
          disabled={busy}
          onChange={(event) => void changeScope(
            conversation.scope.artifactId as "brief" | "bible" | "routes" | "endings" | "mechanics",
            event.target.value,
          )}
        >
          {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
        </select>
      </label>}
      <p className="scope-version">Project: {props.project.name} · Base: {currentArtifact ? `${props.activeArtifact} v${currentArtifact.version}` : "project only"}</p>
    </header>

    <details className="author-memory-preview">
      <summary>Context preview</summary>
      <p className="field-note">Non-canonical author memory. Structured project versions remain authoritative.</p>
      <dl>
        <div><dt>Summary</dt><dd>{memory?.summary ? `v${memory.summary.version} · ${memory.summary.sourceRange.messageCount} covered messages` : memory?.diagnostics.summaryStatus === "stale" ? "Stale summary omitted" : "None"}</dd></div>
        <div><dt>Pinned decisions</dt><dd>{memory?.decisions.length ?? 0} included{memory?.diagnostics.omittedDecisionCount ? ` · ${memory.diagnostics.omittedDecisionCount} omitted by bounds` : ""}</dd></div>
        <div><dt>Recent messages</dt><dd>{memory?.recentMessages.length ?? 0} retained separately
          {memory?.diagnostics.omittedRecentMessageCount
            ? ` · ${memory.diagnostics.omittedRecentMessageCount} omitted (${(memory.diagnostics.omittedRecentMessageBytes ?? 0).toLocaleString()} bytes)`
            : ""}</dd></div>
        <div><dt>Author-memory size</dt><dd>{(memory?.diagnostics.totalAuthorMemoryBytes ?? 0).toLocaleString()} bounded bytes</dd></div>
      </dl>
      {memory?.summary && <p>{memory.summary.content}</p>}
      {memory?.decisions.map((decision) => <article className="pinned-decision" key={decision.stableId}>
        <strong>{decision.content}</strong>
        <small>{decision.scope.kind} scope · v{decision.version} · active</small>
        <button type="button" disabled={busy} onClick={async () => {
          await updatePinnedDecision(props.project.id, decision.stableId, { status: "withdrawn" });
          if (conversation) setMemory(await loadAuthorMemoryContext(props.project.id, conversation.id, conversation.scope));
        }}>Withdraw</button>
      </article>)}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!conversation || !decisionContent.trim()) return;
        void (async () => {
          setBusy(true); setError(null);
          try {
            const scope = conversation.scope.kind === "artifact"
              ? { kind: "artifact" as const, artifactId: conversation.scope.artifactId! }
              : { kind: "project" as const };
            await createPinnedDecision(props.project.id, { scope, content: decisionContent,
              provenance: messages.at(-1) ? { messageId: messages.at(-1)!.id } : { note: "Pinned by author" } });
            setDecisionContent("");
            setMemory(await loadAuthorMemoryContext(props.project.id, conversation.id, conversation.scope));
          } catch (reason) { setError((reason as Error).message); }
          finally { setBusy(false); }
        })();
      }}>
        <label>Pin a decision<textarea value={decisionContent} maxLength={2000}
          onChange={(event) => setDecisionContent(event.target.value)} /></label>
        <button disabled={busy || !decisionContent.trim()}>Pin for this scope</button>
      </form>
    </details>

    <div className="assistant-history" ref={historyRef}>
      {historyNotice && <p className="field-note" role="status">{historyNotice} Older immutable history remains stored.</p>}
      {messages.length === 0 && <p className="field-note">Ask questions freely, or choose “Propose change” when you want a reviewable edit to the {artifactLabel}.</p>}
      {messages.length > visibleMessageCount && <button type="button" onClick={() => setVisibleMessageCount((count) => count + 80)}>
        Show 80 older messages ({messages.length - visibleMessageCount} hidden)
      </button>}
      {messages.slice(-visibleMessageCount).map((message) => <article className={`chat-message ${message.role}`} key={message.id}>
        <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
        <p>{message.content}</p>
        <small>{message.intent} · {String(message.metadata.artifactId ?? "artifact")} v{String(message.metadata.artifactVersion ?? "?")}</small>
      </article>)}
      {proposals.slice(-50).map((proposal) => <ProposalCard
        key={proposal.id}
        proposal={proposal}
        currentVersionId={proposal.artifactId === "mechanics"
          ? props.mechanics?.id ?? ""
          : proposal.artifactId === "endings"
            ? props.endings?.id ?? ""
            : proposal.artifactId === "routes"
              ? props.routes?.id ?? ""
              : proposal.artifactId === "bible"
                ? props.bible?.id ?? ""
                : props.brief.id}
        busy={busy}
        onApply={async (groupIds) => {
          if (!conversation) return;
          setBusy(true);
          setError(null);
          try {
            await applyProposal(props.project.id, conversation.id, proposal.id, groupIds);
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
            <option value="propose" disabled={conversation?.scope.kind === "project"}>Propose change</option>
          </select>
        </label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={intent === "discuss"
          ? `Ask about the ${artifactLabel}…`
          : `Describe the exact ${artifactLabel} change you want…`}
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
  currentVersionId: string;
  busy: boolean;
  onApply(groupIds: string[]): Promise<void>;
  onReject(): Promise<void>;
}) {
  const groups = props.proposal.proposal?.groups ?? [];
  const [selected, setSelected] = useState(() => new Set(groups.map((group) => group.id)));
  const stale = props.proposal.status === "proposed" && props.proposal.baseVersionId !== props.currentVersionId;
  return <article className={`proposal-card ${props.proposal.status}`}>
    <header>
      <strong>{props.proposal.artifactId === "mechanics" ? "Mechanics" : props.proposal.artifactId === "endings" ? "Endings" : props.proposal.artifactId === "routes" ? "Routes" : props.proposal.artifactId === "bible" ? "Bible" : "Brief"} change proposal</strong>
      <span>{stale ? "outdated" : props.proposal.status}</span>
    </header>
    <h3>{props.proposal.summary}</h3>
    <p>{props.proposal.rationale}</p>
    <p className="field-note">Applying creates a new draft version; it does not approve it.</p>
    <div className="proposal-groups">
      {groups.map((group) => <label className="proposal-group" key={group.id}>
        <input
          type="checkbox"
          checked={selected.has(group.id)}
          disabled={(!group.safeToApplyIndependently && groups.length > 1)
            || groups.some((item) => selected.has(item.id) && item.dependsOnGroupIds.includes(group.id))}
          onChange={(event) => setSelected((current) => {
            const next = new Set(current);
            if (event.target.checked) next.add(group.id); else next.delete(group.id);
            return next;
          })}
        />
        <span>
          <strong>{group.label}</strong>
          <small>{group.summary}</small>
          <small>{group.operations.length} operation(s){group.dependsOnGroupIds.length > 0 ? ` · depends on ${group.dependsOnGroupIds.join(", ")}` : ""}</small>
        </span>
      </label>)}
    </div>
    {props.proposal.validationFindings.length > 0 && <details>
      <summary>Validation findings ({props.proposal.validationFindings.length})</summary>
      {props.proposal.validationFindings.map((finding, index) =>
        <p className={`validation-${finding.severity}`} key={`${finding.code}-${index}`}>{finding.severity}: {finding.message}</p>)}
    </details>}
    {props.proposal.status === "proposed" && <div className="proposal-actions">
      <button disabled={props.busy} onClick={() => void props.onReject()}>Reject</button>
      <button
        className="primary"
        disabled={props.busy || stale || selected.size === 0 || props.proposal.validationFindings.some((finding) => finding.severity === "error")}
        onClick={() => void props.onApply([...selected])}
      >Apply selected</button>
    </div>}
  </article>;
}
