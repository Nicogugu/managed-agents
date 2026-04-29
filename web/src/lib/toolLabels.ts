import type { ToolCall } from "../types";

// Labels user-friendly pour chaque appel d'outil. On déduit du nom + input
// une description compréhensible en français au lieu d'afficher 'web_fetch'
// avec une URL brute.
export type FriendlyLabel = { icon: string; verb: string; detail?: string };

export function prettyPath(p?: string): string {
  if (!p) return "";
  if (p.startsWith("/mnt/memory/wp-editor-knowledge/")) {
    return p.replace("/mnt/memory/wp-editor-knowledge/", "mémoire/");
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}

export function friendlyLabel(call: { name: string; input?: Record<string, any> }): FriendlyLabel {
  const i = call.input || {};
  const name = call.name;
  switch (name) {
    case "bash": {
      const cmd = String(i.command || "").trim();
      if (/^cat /.test(cmd)) {
        return { icon: "📄", verb: "Lit", detail: prettyPath(cmd.replace(/^cat\s+/, "").split(/\s/)[0]) };
      }
      if (/^ls /.test(cmd)) {
        return { icon: "📁", verb: "Liste", detail: prettyPath(cmd.replace(/^ls\s+(-\S+\s+)?/, "").split(/\s/)[0]) };
      }
      if (/^mkdir /.test(cmd)) {
        return { icon: "📁", verb: "Crée dossier", detail: prettyPath(cmd.replace(/^mkdir\s+(-p\s+)?/, "").split(/\s/)[0]) };
      }
      if (/curl.*\/api\/image/.test(cmd)) {
        const m = cmd.match(/"prompt":"([^"]+)"/);
        return { icon: "🎨", verb: "Génère une image", detail: m?.[1] };
      }
      if (/^echo /.test(cmd)) {
        const m = cmd.match(/echo\s+["']([^"']+)["']/);
        return { icon: "✎", verb: "Écrit", detail: m?.[1] };
      }
      return { icon: "›_", verb: "Shell", detail: cmd };
    }
    case "read":
      return { icon: "📄", verb: "Lit", detail: prettyPath(i.path || i.file_path) };
    case "write":
      return { icon: "✎", verb: "Écrit", detail: prettyPath(i.path || i.file_path) };
    case "edit":
      return { icon: "✎", verb: "Édite", detail: prettyPath(i.path || i.file_path) };
    case "glob":
      return { icon: "*", verb: "Cherche fichiers", detail: i.pattern };
    case "grep":
      return { icon: "⌕", verb: "Cherche dans code", detail: [i.pattern, i.path].filter(Boolean).join("  in  ") };
    case "web_search":
      return { icon: "🔎", verb: "Recherche web", detail: i.query };
    case "web_fetch": {
      const url = String(i.url || "");
      if (url.includes("/api/wp/posts/")) {
        const m = url.match(/\/api\/wp\/posts\/(\d+)/);
        return { icon: "📋", verb: "Lit l'article WP", detail: m ? `#${m[1]}` : "" };
      }
      if (url.includes("/api/wp/posts")) {
        const search = url.match(/[?&]search=([^&]+)/)?.[1];
        if (search)
          return { icon: "🔍", verb: "Cherche articles WP", detail: decodeURIComponent(search.replace(/\+/g, " ")) };
        return { icon: "📋", verb: "Liste articles WP" };
      }
      if (url.includes("/api/wp/categories")) return { icon: "🏷", verb: "Liste catégories WP" };
      if (url.includes("/api/wp/tags")) return { icon: "🏷", verb: "Liste tags WP" };
      if (url.includes("/api/wp/media")) return { icon: "🖼", verb: "Liste médias WP" };
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {}
      return { icon: "↓", verb: "Fetch", detail: host };
    }
    case "wp_image_generate":
      return { icon: "🎨", verb: "Génère une image", detail: i.prompt };
    case "wp_publish":
      return {
        icon: "🚀",
        verb: i.action === "update" ? "Met à jour l'article WP" : "Publie l'article WP",
        detail: i.title,
      };
    default:
      return { icon: "🔧", verb: name };
  }
}

export function toolIconChar(name: string): string {
  return friendlyLabel({ name }).icon;
}

export function summarizeToolForLine(call: ToolCall): string {
  const f = friendlyLabel(call);
  const text = f.detail ? `${f.verb} · ${f.detail}` : f.verb;
  return text.replace(/\s+/g, " ").slice(0, 110);
}
