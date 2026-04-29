import { describe, it, expect } from "vitest";
import {
  findNextCustomBlock,
  parseGutenbergBlock,
  serializeGutenbergBlock,
} from "./gutenberg.js";

describe("Gutenberg parser", () => {
  it("parses a superprof/quote-block back to typed instance", () => {
    const html =
      '<!-- wp:superprof/quote-block {"quote":"Hello","citation":"Anon"} -->\n' +
      '<blockquote class="wp-block-superprof-quote-block"><p>Hello</p><cite>Anon</cite></blockquote>\n' +
      "<!-- /wp:superprof/quote-block -->";
    const r = parseGutenbergBlock(html);
    expect(r).not.toBeNull();
    expect(r!.instance.namespace).toBe("superprof/quote-block");
    expect(r!.instance.attrs.quote).toBe("Hello");
    expect(r!.instance.attrs.citation).toBe("Anon");
  });

  it("parses a self-closing children block (poll-item)", () => {
    const html =
      '<!-- wp:superprof/polls-block {"pollId":"abc","pollQuestion":"Q ?"} -->\n' +
      '<div data-poll-id="abc" class="wp-block-superprof-polls-block">' +
      '<!-- wp:poll/poll-item {"choiceId":"c1","choiceIndex":0,"choiceText":"Un"} /-->' +
      '<!-- wp:poll/poll-item {"choiceId":"c2","choiceIndex":1,"choiceText":"Deux"} /-->' +
      "</div>\n" +
      "<!-- /wp:superprof/polls-block -->";
    const r = parseGutenbergBlock(html);
    expect(r).not.toBeNull();
    expect(r!.instance.namespace).toBe("superprof/polls-block");
    expect(r!.instance.attrs.pollQuestion).toBe("Q ?");
    expect(r!.instance.children).toHaveLength(2);
    expect(r!.instance.children![0].attrs.choiceText).toBe("Un");
    expect(r!.instance.children![1].attrs.choiceIndex).toBe(1);
  });

  it("parses paired-form children (timeline-container)", () => {
    const html =
      "<!-- wp:superprof/timeline-block -->\n" +
      '<div class="wp-block-superprof-timeline-block timeline medium">' +
      '<!-- wp:timeline/timeline-container {"itemDate":"2024","itemTitle":"A"} -->' +
      "<div></div>" +
      "<!-- /wp:timeline/timeline-container -->" +
      '<!-- wp:timeline/timeline-container {"itemDate":"2025","itemTitle":"B","isLast":true} -->' +
      "<div></div>" +
      "<!-- /wp:timeline/timeline-container -->" +
      "</div>\n" +
      "<!-- /wp:superprof/timeline-block -->";
    const r = parseGutenbergBlock(html);
    expect(r).not.toBeNull();
    expect(r!.instance.children).toHaveLength(2);
    expect(r!.instance.children![0].attrs.itemTitle).toBe("A");
    expect(r!.instance.children![1].attrs.isLast).toBe(true);
  });

  it("returns null when no known namespace is present", () => {
    expect(parseGutenbergBlock("<p>plain</p>")).toBeNull();
    expect(
      parseGutenbergBlock(
        '<!-- wp:unknown/foo {"x":1} --><div></div><!-- /wp:unknown/foo -->',
      ),
    ).toBeNull();
  });

  it("findNextCustomBlock returns positions when in a larger doc", () => {
    const html =
      "<p>before</p>\n" +
      '<!-- wp:superprof/quote-block {"quote":"X","citation":"Y"} -->\n' +
      "<blockquote><p>X</p></blockquote>\n" +
      "<!-- /wp:superprof/quote-block -->\n" +
      "<p>after</p>";
    const r = findNextCustomBlock(html, 0);
    expect(r).not.toBeNull();
    expect(r!.start).toBeGreaterThan(0);
    expect(r!.end).toBeLessThan(html.length);
  });
});

describe("Gutenberg serializer (round-trip)", () => {
  it("roundtrips quote-block losslessly", () => {
    const original = {
      namespace: "superprof/quote-block",
      attrs: { quote: "Le test", citation: "PM" },
    };
    const html = serializeGutenbergBlock(original);
    const parsed = parseGutenbergBlock(html);
    expect(parsed!.instance.namespace).toBe(original.namespace);
    expect(parsed!.instance.attrs).toEqual(original.attrs);
  });

  it("roundtrips polls-block with children", () => {
    const original = {
      namespace: "superprof/polls-block",
      attrs: { pollId: "p1", pollQuestion: "Quoi ?" },
      children: [
        { attrs: { choiceId: "c1", choiceIndex: 0, choiceText: "A" } },
        { attrs: { choiceId: "c2", choiceIndex: 1, choiceText: "B" } },
      ],
    };
    const html = serializeGutenbergBlock(original);
    const parsed = parseGutenbergBlock(html);
    expect(parsed!.instance.children).toHaveLength(2);
    expect(parsed!.instance.children![0].attrs.choiceText).toBe("A");
    expect(parsed!.instance.attrs.pollQuestion).toBe("Quoi ?");
  });

  it("roundtrips timeline-block with isLast on the final item", () => {
    const original = {
      namespace: "superprof/timeline-block",
      attrs: {},
      children: [
        { attrs: { itemDate: "Y1", itemTitle: "T1", itemColor: "#ff6363" } },
        { attrs: { itemDate: "Y2", itemTitle: "T2", itemColor: "#ff6363" } },
      ],
    };
    const html = serializeGutenbergBlock(original);
    expect(html).toContain('"isLast":true');
    const parsed = parseGutenbergBlock(html);
    expect(parsed!.instance.children).toHaveLength(2);
    expect(parsed!.instance.children![1].attrs.isLast).toBe(true);
  });
});
