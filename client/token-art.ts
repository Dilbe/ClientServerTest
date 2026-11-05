// Pictures on the tokens (issue #344, the first step of #234).
//
// A picture is drawn on top of the token's coloured disc, in the token's own
// coordinates: (0, 0) is the centre and the disc has a radius of 15 (half of
// HEX_SIZE). It is inline SVG, made of a few shapes, like the hex map itself:
// it stays sharp at any zoom, and style.css colours it, so the token states
// (asleep, frozen, ...) still work. There are no image files to load.
//
// Only the rat (issue #344) and the adventurer (issue #346) have a picture
// so far; every other token keeps its letter or number.

import type { ClassId } from "../shared/rules/classes.ts";
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

/** The picture for a character of this class and rank, or undefined if that class has none yet. */
export function characterArt(classId: ClassId, rank: number): SVGGElement | undefined {
  return classId === "adventurer" ? adventurer(rank) : undefined;
}

/**
 * An adventurer: a sword that gets a bit grander with each rank, so a
 * higher rank stands out at a glance (issue #346).
 *
 * | Rank | Picture |
 * |---|---|
 * | 1 | a short, plain sword |
 * | 2 | a longer sword with a crossguard |
 * | 3 | the rank 2 sword with a gem on the pommel |
 * | 4 | two crossed swords |
 * | 5 | two crossed swords with a small star above |
 */
function adventurer(rank: number): SVGGElement {
  const g = svgElement("g", { class: "art adventurer" });
  if (rank <= 1) {
    g.append(sword({ long: false, gem: false, angle: -45 }));
  } else if (rank <= 3) {
    g.append(sword({ long: true, gem: rank === 3, angle: -45 }));
  } else {
    // Two swords would reach the number badge, so they are drawn a bit
    // smaller, and a bit lower to leave room for the star.
    const crossed = svgElement("g", { transform: "translate(0 1.5) scale(0.82)" });
    crossed.append(sword({ long: true, gem: false, angle: -38 }), sword({ long: true, gem: false, angle: 38 }));
    g.append(crossed);
    if (rank >= 5) g.append(star(0, -10, 4.2));
  }
  return g;
}

/**
 * One sword, drawn pointing up around the centre of the token, then turned
 * `angle` degrees (clockwise, as SVG turns). The fuller (the groove down
 * the blade) and the gem are "holes": they show the colour of the disc.
 */
function sword({ long, gem, angle }: { long: boolean; gem: boolean; angle: number }): SVGGElement {
  // y values from the tip down to the pommel; a long sword has a longer
  // blade and a wider crossguard.
  const tip = long ? -13 : -9;
  const guard = long ? 3.5 : 2.5;
  const halfBlade = long ? 1.8 : 1.6;
  const halfGuard = long ? 5.5 : 3;
  const g = svgElement("g", { transform: `rotate(${angle})` });
  g.append(
    // The blade: straight edges up to a point.
    svgElement("path", {
      class: "fill",
      d: `M ${-halfBlade} ${guard} L ${-halfBlade} ${tip + 3} L 0 ${tip} L ${halfBlade} ${tip + 3} L ${halfBlade} ${guard} Z`,
    }),
    svgElement("rect", { class: "fill", x: -halfGuard, y: guard, width: 2 * halfGuard, height: 1.8, rx: 0.9 }),
    svgElement("rect", { class: "fill", x: -0.9, y: guard + 1.8, width: 1.8, height: 4 }),
    svgElement("circle", { class: "fill", cy: guard + 6.6, r: gem ? 3 : 1.5 }),
  );
  if (long) g.append(svgElement("line", { class: "groove", x1: 0, y1: tip + 4, x2: 0, y2: guard - 1 }));
  if (gem) g.append(svgElement("circle", { class: "hole", cy: guard + 6.6, r: 1.6 }));
  return g;
}

/** A five-pointed star with its centre at (x, y). */
function star(x: number, y: number, radius: number): SVGPolygonElement {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`);
  }
  return svgElement("polygon", { class: "fill", points: points.join(" ") });
}

/**
 * The number of a monster or character in a small badge at the top right
 * of its token, so tokens with the same picture can still be told apart
 * ("R1", "R2" or "1", "2" in the track and the log).
 */
export function tokenNumber(n: number): SVGGElement {
  const g = svgElement("g", { class: "number" });
  const text = svgElement("text", { x: 10, y: -10 });
  text.textContent = String(n);
  g.append(svgElement("circle", { cx: 10, cy: -10, r: 5.5 }), text);
  return g;
}
