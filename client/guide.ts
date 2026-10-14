// The game guide screen (design.md, The game guide): read-only reference
// pages built from the shared rule data. guide-content.ts decides what it
// says; this file only turns that into HTML.
//
// Every text goes in with textContent, never innerHTML: the data is our own,
// but this way a "<" in a name could never become HTML.

import { guideSections, type GuideBlock, type GuideCard } from "./guide-content.ts";

function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text?: string): HTMLElementTagNameMap[K] {
  const child = document.createElement(tag);
  if (text !== undefined) child.textContent = text;
  parent.append(child);
  return child;
}

function renderCard(parent: HTMLElement, card: GuideCard): void {
  const article = add(parent, "article");
  article.className = "guide-card";
  article.id = card.id;
  add(article, "h4", card.title);
  if (card.text) add(article, "p", card.text);
  const list = add(article, "dl");
  for (const [name, value] of card.facts) {
    add(list, "dt", name);
    if (typeof value === "string") {
      add(list, "dd", value);
    } else {
      const items = add(add(list, "dd"), "ol");
      for (const item of value) add(items, "li", item);
    }
  }
}

function renderBlock(parent: HTMLElement, block: GuideBlock): void {
  if (block.kind === "paragraph") {
    add(parent, "p", block.text);
  } else if (block.kind === "table") {
    // A wide table scrolls sideways in its own box, so the page itself never
    // does on a phone.
    const box = add(parent, "div");
    box.className = "table-scroll";
    const table = add(box, "table");
    const headings = add(add(table, "thead"), "tr");
    for (const heading of block.headings) add(headings, "th", heading);
    const body = add(table, "tbody");
    for (const row of block.rows) {
      const tr = add(body, "tr");
      for (const cell of row) add(tr, "td", cell);
    }
  } else {
    for (const card of block.cards) renderCard(parent, card);
  }
}

/**
 * Fills the guide once, at start: the data is part of the client and never
 * changes while it runs. The contents list links to each section.
 */
export function renderGuide(contents: HTMLElement, container: HTMLElement): void {
  for (const section of guideSections()) {
    const link = add(add(contents, "li"), "a", section.title);
    // A button-like jump instead of an "#id" link: the part after "#" is the
    // screen's address (#/guide), so changing it would leave the guide.
    link.href = "#/guide";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(`guide-${section.id}`)?.scrollIntoView();
    });
    const element = add(container, "section");
    element.id = `guide-${section.id}`;
    add(element, "h3", section.title);
    for (const block of section.blocks) renderBlock(element, block);
  }
}
