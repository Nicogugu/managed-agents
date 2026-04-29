import { useEffect, useRef, useState } from "react";
import type {
  ReviewEvent,
  ReviewKind,
  ReviewSnapshot,
  ReviewStatus,
} from "../../contract";

const KINDS: { kind: ReviewKind; icon: string; label: string }[] = [
  { kind: "legal", icon: "⚖️", label: "Légal" },
  { kind: "fact", icon: "🔍", label: "Fact-check" },
  { kind: "links", icon: "🔗", label: "Liens internes" },
];

interface Props {
  sessionId: string | null;
  /** Called when the user clicks a finding's block link — scroll into view + flash. */
  onFocusBlock?: (blockId: string) => void;
}

export function PrePublishReview({ sessionId, onFocusBlock }: Props) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>({
    content_hash: "",
    results: {},
  });
  const [busyKinds, setBusyKinds] = useState<Set<ReviewKind>>(new Set());
  const [expanded, setExpanded] = useState<ReviewKind | null>(null);
  const [now, setNow] = useState(Date.now());

  // Tick clock so the running timers refresh
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // SSE: subscribe to /draft/review/stream so we hear progress.
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/sessions/${sessionId}/draft/review/stream`);
    es.onmessage = (e) => {
      let data: ReviewEvent;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.type === "review.batch_finished" || data.type === "review.batch_started") {
        setSnapshot((prev) => ({
          content_hash: data.content_hash,
          results: { ...prev.results, ...(data.results || {}) },
        }));
        if (data.type === "review.batch_finished") setBusyKinds(new Set());
      } else if (data.type === "review.kind_started" || data.type === "review.kind_finished") {
        setSnapshot((prev) => ({
          content_hash: prev.content_hash,
          results: { ...prev.results, [data.kind]: data.status },
        }));
        if (data.type === "review.kind_finished") {
          setBusyKinds((prev) => {
            const next = new Set(prev);
            next.delete(data.kind);
            return next;
          });
        }
      }
    };
    es.onerror = () => {};
    return () => es.close();
  }, [sessionId]);

  async function trigger(kinds: ReviewKind[]) {
    if (!sessionId) return;
    setBusyKinds((prev) => {
      const next = new Set(prev);
      for (const k of kinds) next.add(k);
      return next;
    });
    try {
      await fetch(`/api/sessions/${sessionId}/draft/review/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kinds }),
      });
    } catch {
      setBusyKinds(new Set());
    }
  }

  const allFindings = KINDS.flatMap(({ kind }) => {
    const r = snapshot.results[kind];
    if (r && (r.state === "passed" || r.state === "warned" || r.state === "failed"))
      return r.findings.map((f) => ({ kind, finding: f }));
    return [];
  });
  const totalErrors = allFindings.filter((x) => x.finding.severity === "error").length;
  const totalWarns = allFindings.filter((x) => x.finding.severity === "warn").length;

  return (
    <div className="surface rounded-md text-sm">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-medium text-text-primary">
          Review pré-publication
        </span>
        {(totalErrors > 0 || totalWarns > 0) && (
          <span className="text-xs">
            {totalErrors > 0 && (
              <span className="text-red-400 mr-2">🛑 {totalErrors} erreur{totalErrors > 1 ? "s" : ""}</span>
            )}
            {totalWarns > 0 && (
              <span className="text-amber-400">⚠️ {totalWarns} avertissement{totalWarns > 1 ? "s" : ""}</span>
            )}
          </span>
        )}
      </div>
      <div className="px-3 pb-2 flex flex-wrap gap-2">
        {KINDS.map(({ kind, icon, label }) => (
          <button
            key={kind}
            onClick={() => trigger([kind])}
            disabled={busyKinds.has(kind)}
            className="btn-ghost !py-1 !px-2 text-xs"
          >
            {icon} {label}
          </button>
        ))}
        <button
          onClick={() => trigger(["legal", "fact", "links"])}
          disabled={busyKinds.size > 0}
          className="btn-primary !py-1 !px-2 text-xs"
        >
          ✨ Tous (parallèle)
        </button>
      </div>
      <div className="border-t border-border">
        {KINDS.map(({ kind, icon, label }) => {
          const status = snapshot.results[kind];
          const open = expanded === kind;
          return (
            <ReviewRow
              key={kind}
              kind={kind}
              icon={icon}
              label={label}
              status={status}
              now={now}
              open={open}
              onToggle={() => setExpanded(open ? null : kind)}
              onFocusBlock={onFocusBlock}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReviewRow({
  kind: _kind,
  icon,
  label,
  status,
  now,
  open,
  onToggle,
  onFocusBlock,
}: {
  kind: ReviewKind;
  icon: string;
  label: string;
  status: ReviewStatus | undefined;
  now: number;
  open: boolean;
  onToggle: () => void;
  onFocusBlock?: (blockId: string) => void;
}) {
  const summary = (() => {
    if (!status) return <span className="text-text-muted text-xs">—</span>;
    if (status.state === "queued")
      return <span className="text-text-tertiary text-xs">en attente…</span>;
    if (status.state === "running")
      return (
        <span className="text-accent text-xs inline-flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Analyse… {Math.max(0, Math.floor((now - status.started_at) / 1000))}s
        </span>
      );
    if (status.state === "error")
      return <span className="text-red-400 text-xs">Erreur · {status.error}</span>;
    if (status.state === "passed")
      return <span className="text-emerald-400 text-xs">✓ Aucun problème</span>;
    const errs = status.findings.filter((f) => f.severity === "error").length;
    const warns = status.findings.filter((f) => f.severity === "warn").length;
    const infos = status.findings.filter((f) => f.severity === "info").length;
    return (
      <span className="text-xs">
        {errs > 0 && <span className="text-red-400 mr-2">🛑 {errs}</span>}
        {warns > 0 && <span className="text-amber-400 mr-2">⚠️ {warns}</span>}
        {infos > 0 && <span className="text-text-secondary">{infos} suggestion{infos > 1 ? "s" : ""}</span>}
      </span>
    );
  })();

  const findings =
    status && (status.state === "passed" || status.state === "warned" || status.state === "failed")
      ? status.findings
      : [];

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={onToggle}
        disabled={findings.length === 0}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-tertiary disabled:hover:bg-transparent disabled:cursor-default transition-colors"
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-text-primary text-xs flex-shrink-0">{label}</span>
        <span className="flex-1 text-right pr-2 truncate">{summary}</span>
        {findings.length > 0 && (
          <span className="text-text-muted text-xs">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && findings.length > 0 && (
        <ul className="px-3 pb-2 space-y-1.5">
          {findings.map((f, i) => (
            <li
              key={i}
              className={`text-xs rounded p-2 border ${
                f.severity === "error"
                  ? "border-red-500/30 bg-red-500/5"
                  : f.severity === "warn"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border bg-bg-tertiary"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0">
                  {f.severity === "error" ? "🛑" : f.severity === "warn" ? "⚠️" : "💡"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary">{f.message}</div>
                  {f.suggestion && (
                    <div className="text-text-tertiary mt-1">↳ {f.suggestion}</div>
                  )}
                  {f.suggested_link && (
                    <div className="text-text-tertiary mt-1">
                      🔗 lier « <span className="font-medium">{f.suggested_link.anchor_text}</span> » → article #{f.suggested_link.post_id}
                    </div>
                  )}
                  {f.block_id && onFocusBlock && (
                    <button
                      type="button"
                      onClick={() => onFocusBlock(f.block_id!)}
                      className="mt-1 text-accent underline text-[11px]"
                    >
                      → aller au bloc
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
