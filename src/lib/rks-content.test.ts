import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRksDoc, rksIndentCss, rksNarrativeHtml } from "./rks-content";

const para = (text: string, textAlign?: string) => ({ type: "paragraph", ...(textAlign ? { attrs: { textAlign } } : {}), content: [{ type: "text", text }] });

test("paragraph alignment (left, center, right, justify) survives normalization; unknown values are dropped", () => {
  const doc = normalizeRksDoc({ type: "doc", content: [para("a", "left"), para("b", "center"), para("c", "right"), para("d", "justify"), para("e", "diagonal")] });
  assert.deepEqual(doc?.content?.map((node) => node.attrs?.textAlign ?? null), ["left", "center", "right", "justify", null]);
});

test("downloaded RKS paragraphs use the chosen alignment and default to justify", () => {
  const doc = normalizeRksDoc({ type: "doc", content: [para("Tengah", "center"), para("Kanan", "right"), para("Kiri", "left"), para("Biasa")] })!;
  const html = rksNarrativeHtml(doc, 5, 4);
  const css = rksIndentCss(html, "");
  const alignOf = (text: string) => {
    const cls = html.match(new RegExp(`<p class=(\\S+?)>${text}</p>`))?.[1];
    return css.match(new RegExp(`p\\.${cls} \\{[^}]*text-align:(\\w+)`))?.[1];
  };
  assert.equal(alignOf("Tengah"), "center");
  assert.equal(alignOf("Kanan"), "right");
  assert.equal(alignOf("Kiri"), "left");
  assert.equal(alignOf("Biasa"), "justify");
});
