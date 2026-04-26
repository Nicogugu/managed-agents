import { describe, it, expect } from "vitest";
import { extractDrafts, stripDraftFences } from "./parseDraft";

describe("extractDrafts", () => {
  it("extracts a single create draft", () => {
    const text = `Voici l'article :
\`\`\`wp-post
{"action":"create","title":"Hello","content":"<p>Hi</p>","status":"draft"}
\`\`\`
Dis-moi si ça te va.`;
    const drafts = extractDrafts(text);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      action: "create",
      title: "Hello",
      content: "<p>Hi</p>",
      status: "draft",
    });
  });

  it("extracts an update draft with id", () => {
    const text = `\`\`\`wp-post
{"action":"update","id":42,"title":"Updated"}
\`\`\``;
    const drafts = extractDrafts(text);
    expect(drafts[0]).toMatchObject({ action: "update", id: 42 });
  });

  it("extracts multiple drafts", () => {
    const text = `
\`\`\`wp-post
{"action":"create","title":"A"}
\`\`\`
some text
\`\`\`wp-post
{"action":"create","title":"B"}
\`\`\`
`;
    expect(extractDrafts(text)).toHaveLength(2);
  });

  it("ignores invalid JSON without throwing", () => {
    const text = `\`\`\`wp-post
not-json
\`\`\``;
    expect(extractDrafts(text)).toEqual([]);
  });

  it("ignores blocks without action create/update", () => {
    const text = `\`\`\`wp-post
{"action":"delete","id":1}
\`\`\``;
    expect(extractDrafts(text)).toEqual([]);
  });

  it("ignores other code fence languages", () => {
    const text = `\`\`\`json
{"action":"create","title":"x"}
\`\`\``;
    expect(extractDrafts(text)).toEqual([]);
  });
});

describe("stripDraftFences", () => {
  it("removes wp-post blocks but keeps surrounding prose", () => {
    const text = `Avant
\`\`\`wp-post
{"action":"create","title":"x"}
\`\`\`
Après`;
    const stripped = stripDraftFences(text);
    expect(stripped).toContain("Avant");
    expect(stripped).toContain("Après");
    expect(stripped).not.toContain("wp-post");
    expect(stripped).not.toContain("action");
  });

  it("returns text unchanged if no fence", () => {
    expect(stripDraftFences("hello world")).toBe("hello world");
  });
});
