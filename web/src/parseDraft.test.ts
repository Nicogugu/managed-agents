import { describe, it, expect } from "vitest";
import { extractAsks, extractPlans, extractTodos, stripBlocks } from "./parseDraft";

describe("extractAsks", () => {
  it("parses an ask block", () => {
    const text = `\`\`\`ask
{"question":"Choisis","options":[{"label":"A","value":"a"}]}
\`\`\``;
    const asks = extractAsks(text);
    expect(asks).toHaveLength(1);
    expect(asks[0].options[0]).toMatchObject({ label: "A", value: "a" });
  });

  it("ignores invalid JSON", () => {
    expect(extractAsks("```ask\nnope\n```")).toEqual([]);
  });
});

describe("extractPlans", () => {
  it("parses a wp-plan", () => {
    const text = `\`\`\`wp-plan
{"title":"x","outline":["a","b"]}
\`\`\``;
    expect(extractPlans(text)[0]).toMatchObject({ title: "x" });
  });
});

describe("extractTodos", () => {
  it("parses a todos block", () => {
    const text = `\`\`\`todos
- [ ] open
- [x] done
- [-] doing
\`\`\``;
    const todos = extractTodos(text);
    expect(todos.map((t) => t.status)).toEqual(["pending", "done", "in_progress"]);
  });

  it("falls back to free-text checklist", () => {
    expect(extractTodos("- [ ] write\n- [x] ship")).toHaveLength(2);
  });
});

describe("stripBlocks", () => {
  it("removes wp-plan / todos / ask fences", () => {
    const text = `before\n\`\`\`ask\n{"options":[{"label":"a","value":"a"}]}\n\`\`\`\nafter`;
    const out = stripBlocks(text);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).not.toContain("ask");
  });
});
