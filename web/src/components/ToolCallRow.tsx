import { useState } from "react";
import type { ToolCall } from "../types";
import { friendlyLabel } from "../lib/toolLabels";

export function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const label = friendlyLabel(call);
  const hasInput = call.input && Object.keys(call.input).length > 0;
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => hasInput && setOpen((o) => !o)}
        className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md border transition-colors ${
          call.status === "running"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-bg-tertiary/40 hover:bg-bg-tertiary"
        }`}
      >
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-base leading-none">{label.icon}</span>
          <span className="text-text-primary font-medium">{label.verb}</span>
          {call.status === "running" ? (
            <span className="text-amber-400 animate-pulse">…</span>
          ) : (
            <span className="text-emerald-500">✓</span>
          )}
        </span>
        {label.detail && (
          <span className="text-text-tertiary truncate flex-1 min-w-0 italic">
            {label.detail}
          </span>
        )}
        {hasInput && (
          <span className="text-text-muted flex-shrink-0">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && hasInput && (
        <div className="mt-1 ml-4 p-2 rounded-md bg-bg-primary border border-border text-[11px]">
          <div className="text-text-muted font-mono mb-1">{call.name}</div>
          <pre className="text-text-secondary font-mono whitespace-pre-wrap break-all max-h-60 overflow-auto">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
