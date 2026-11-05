// Pictures on the tokens (issue #344, the first step of #234).
//
// A picture is drawn on top of the token's coloured disc, in the token's own
// coordinates: (0, 0) is the centre and the disc has a radius of 15 (half of
// HEX_SIZE). It is inline SVG, made of a few shapes, like the hex map itself:
// it stays sharp at any zoom, and style.css colours it, so the token states
// (asleep, frozen, ...) still work. There are no image files to load.
//
// Only the rat has a picture so far; every other token keeps its letter.

import type { MonsterTypeId } from "../shared/rules/stats.ts";
import { svgElement } from "./hex-map.ts";

/** The picture for a monster type, or undefined if that type has none yet. */
export function monsterArt(type: MonsterTypeId): SVGGElement | undefined {
  return type === "rat" ? rat() : undefined;
}

/**
 * A rat seen from the side, facing left: a body with a pointed snout, a
 * large round ear, two feet and a long thin tail curling under it. The
 * "fill" shapes are the white silhouette; eye, nose and the inside of the
 * ear take the colour of the disc, so they look like holes in it.
 */
function rat(): SVGGElement {
  const g = svgElement("g", { class: "art rat" });
  g.append(
    svgElement("path", { class: "line", d: "M 8.5 4 C 13 6, 13 11, 8 11.5 C 5 11.8, 2 11, 0 10.5" }),
    svgElement("path", {
      class: "fill",
      d: "M -13.5 2 C -11 0, -8 -3.5, -3.5 -4.5 C 2 -6.5, 9 -4.5, 10 0.5 C 11 5, 7 7, 2 7 L -5 7 C -8 6, -10 4, -13.5 2 Z",
    }),
    svgElement("ellipse", { class: "fill", cx: -3.5, cy: -5.5, rx: 2.6, ry: 3.4, transform: "rotate(-15 -3.5 -5.5)" }),
    svgElement("ellipse", { class: "hole", cx: -3.5, cy: -5.5, rx: 1.2, ry: 1.9, transform: "rotate(-15 -3.5 -5.5)" }),
    svgElement("circle", { class: "hole", cx: -7.5, cy: -0.3, r: 1.1 }),
    svgElement("circle", { class: "hole", cx: -13.3, cy: 2, r: 1 }),
    svgElement("path", { class: "line", d: "M -4 7 l -1 2.5 M 4 7 l 1 2.5" }),
  );
  return g;
}

/**
 * The monster's number in a small badge at the top right of the token, so
 * tokens with the same picture can still be told apart ("R1", "R2" in the
 * track and the log).
 */
export function monsterNumber(n: number): SVGGElement {
  const g = svgElement("g", { class: "number" });
  const text = svgElement("text", { x: 10, y: -10 });
  text.textContent = String(n);
  g.append(svgElement("circle", { cx: 10, cy: -10, r: 5.5 }), text);
  return g;
}
