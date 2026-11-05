// Pictures on the tokens (issues #344, #346 and #348, from #234).
//
// A picture is drawn on top of the token's coloured disc, in the token's own
// coordinates: (0, 0) is the centre and the disc has a radius of 15 (half of
// HEX_SIZE). It is inline SVG, made of a few shapes, like the hex map itself:
// it stays sharp at any zoom, and style.css colours it, so the token states
// (asleep, frozen, ...) still work. There are no image files to load.
//
// Every class and every monster type has a picture. The tables below are a
// `Record` over all class and monster type ids, so TypeScript refuses to
// compile when a new one is added without a picture.
//
// The shapes use four classes, coloured in style.css:
// - "fill": the white silhouette.
// - "line": a white line (with "thick" or "thin" for other widths).
// - "hole": a shape in the disc's colour, so it looks like a hole (an eye, a gem).
// - "groove": a thin line in the disc's colour, cut into the silhouette.

import type { ClassId } from "../shared/rules/classes.ts";
import type { MonsterTypeId } from "../shared/rules/stats.ts";
import { svgElement } from "./hex-map.ts";

type Attributes = Record<string, string | number>;

const fill = (tag: "path" | "circle" | "rect" | "ellipse" | "polygon", attributes: Attributes) =>
  svgElement(tag, { ...attributes, class: "fill" });
const hole = (tag: "path" | "circle" | "rect" | "ellipse", attributes: Attributes) =>
  svgElement(tag, { ...attributes, class: "hole" });
const line = (d: string, width: "" | "thick" | "thin" = "") => svgElement("path", { d, class: `line ${width}`.trim() });
const groove = (d: string) => svgElement("path", { d, class: "groove" });

/** A group of shapes, turned, scaled or moved by an SVG transform. */
function group(transform: string, ...children: SVGElement[]): SVGGElement {
  const g = svgElement("g", transform ? { transform } : {});
  g.append(...children);
  return g;
}

/** The picture for a monster type. */
export function monsterArt(type: MonsterTypeId): SVGGElement {
  const g = svgElement("g", { class: `art ${type}` });
  g.append(...MONSTER_ART[type]());
  return g;
}

/** The picture for a character of this class and rank. */
export function characterArt(classId: ClassId, rank: number): SVGGElement {
  const g = svgElement("g", { class: `art ${classId}` });
  g.append(...CLASS_ART[classId](rank));
  return g;
}

// ---------------------------------------------------------------------------
// Classes
//
// All classes use the same rank steps (issue #348), so ranks read the same
// way everywhere:
//
// | Rank | Step |
// |---|---|
// | 1 | the plain symbol |
// | 2 | a bigger, more detailed version |
// | 3 | plus a gem (a dot in the disc's colour) |
// | 4 | doubled (the adventurer's two swords) or framed by a ring |
// | 5 | plus a star above |

const CLASS_ART: Record<ClassId, (rank: number) => SVGElement[]> = {
  adventurer,
  tank: (rank) => ranked(rank, shield),
  healer: (rank) => ranked(rank, cross),
  ranger: (rank) => ranked(rank, bow),
  caster: (rank) => ranked(rank, staff),
};

/**
 * The rank steps for a class symbol. `symbol(big, gem)` draws the symbol:
 * plain (rank 1), big (rank 2) or big with a gem (rank 3). From rank 4 the
 * big symbol with its gem stands smaller inside a ring, and rank 5 adds a
 * star above it, inside the ring.
 */
function ranked(rank: number, symbol: (big: boolean, gem: boolean) => SVGElement[]): SVGElement[] {
  if (rank <= 3) return symbol(rank >= 2, rank >= 3);
  // Rank 5 makes the symbol a bit smaller still, to fit the star inside the ring.
  const shown: SVGElement[] = [
    svgElement("circle", { r: 12.6, class: "line thin" }),
    group(rank >= 5 ? "translate(0 2.2) scale(0.6)" : "scale(0.7)", ...symbol(true, true)),
  ];
  if (rank >= 5) shown.push(star(0, -7.8, 3.4));
  return shown;
}

/**
 * An adventurer: a sword that gets a bit grander with each rank (issue
 * #346). Rank 1 is a short, plain sword, rank 2 a longer sword with a
 * crossguard, rank 3 adds a gem on the pommel, rank 4 is two crossed swords
 * and rank 5 adds a small star above.
 */
function adventurer(rank: number): SVGElement[] {
  if (rank <= 1) return [sword({ long: false, gem: false, angle: -45 })];
  if (rank <= 3) return [sword({ long: true, gem: rank === 3, angle: -45 })];
  // Two swords would reach the number badge, so they are drawn a bit
  // smaller, and a bit lower to leave room for the star.
  const crossed = group(
    "translate(0 1.5) scale(0.82)",
    sword({ long: true, gem: false, angle: -38 }),
    sword({ long: true, gem: false, angle: 38 }),
  );
  return rank >= 5 ? [crossed, star(0, -10, 4.2)] : [crossed];
}

/**
 * One sword, drawn pointing up around the centre of the token, then turned
 * `angle` degrees (clockwise, as SVG turns). The fuller (the groove down
 * the blade) and the gem show the colour of the disc.
 */
function sword({ long, gem, angle }: { long: boolean; gem: boolean; angle: number }): SVGGElement {
  // y values from the tip down to the pommel; a long sword has a longer
  // blade and a wider crossguard.
  const tip = long ? -13 : -9;
  const guard = long ? 3.5 : 2.5;
  const halfBlade = long ? 1.8 : 1.6;
  const halfGuard = long ? 5.5 : 3;
  const g = group(
    `rotate(${angle})`,
    // The blade: straight edges up to a point.
    fill("path", {
      d: `M ${-halfBlade} ${guard} L ${-halfBlade} ${tip + 3} L 0 ${tip} L ${halfBlade} ${tip + 3} L ${halfBlade} ${guard} Z`,
    }),
    fill("rect", { x: -halfGuard, y: guard, width: 2 * halfGuard, height: 1.8, rx: 0.9 }),
    fill("rect", { x: -0.9, y: guard + 1.8, width: 1.8, height: 4 }),
    fill("circle", { cy: guard + 6.6, r: gem ? 3 : 1.5 }),
  );
  if (long) g.append(svgElement("line", { class: "groove", x1: 0, y1: tip + 4, x2: 0, y2: guard - 1 }));
  if (gem) g.append(hole("circle", { cy: guard + 6.6, r: 1.6 }));
  return g;
}

/** A tank: a shield; the big one has a rim, the gem sits in its middle. */
function shield(big: boolean, gem: boolean): SVGElement[] {
  const outline = fill("path", { d: "M -8 -9 L 8 -9 L 8 -1 C 8 5, 4 8.5, 0 11 C -4 8.5, -8 5, -8 -1 Z" });
  if (!big) return [group("scale(0.8)", outline)];
  const shown: SVGElement[] = [
    outline,
    groove("M -5.5 -6.5 L 5.5 -6.5 L 5.5 -1 C 5.5 3.5, 2.8 6, 0 8 C -2.8 6, -5.5 3.5, -5.5 -1 Z"),
  ];
  if (gem) shown.push(hole("circle", { cy: -0.5, r: 2.2 }));
  return shown;
}

/** A healer: a cross; the big one has a groove along its edge, the gem sits in its middle. */
function cross(big: boolean, gem: boolean): SVGElement[] {
  const outline = fill("path", {
    d: "M -3.4 -10 H 3.4 V -3.4 H 10 V 3.4 H 3.4 V 10 H -3.4 V 3.4 H -10 V -3.4 H -3.4 Z",
  });
  if (!big) return [group("scale(0.8)", outline)];
  const shown: SVGElement[] = [
    outline,
    groove("M -1.9 -8.5 H 1.9 V -1.9 H 8.5 V 1.9 H 1.9 V 8.5 H -1.9 V 1.9 H -8.5 V -1.9 H -1.9 Z"),
  ];
  if (gem) shown.push(hole("circle", { r: 1.6 }));
  return shown;
}

/**
 * A ranger: a drawn bow with an arrow, pointing to the top left like the
 * adventurer's sword. The big bow has curled tips and a grip; the gem sits
 * on the grip.
 */
function bow(big: boolean, gem: boolean): SVGElement[] {
  const arrow = [
    line("M 0 9 L 0 -9"),
    fill("path", { d: "M 0 -12.5 L -2.6 -7.5 L 2.6 -7.5 Z" }),
    line("M 0 9 l -2 2.5 M 0 9 l 2 2.5", "thin"),
  ];
  if (!big) {
    return [group("rotate(-45) scale(0.85)", line("M -9 4 Q 0 -8 9 4", "thick"), line("M -9 4 L 0 8 L 9 4", "thin"), ...arrow)];
  }
  const shown: SVGElement[] = [
    line("M -11.5 3 C -12 6, -9 6.5, -10 4.5 M 11.5 3 C 12 6, 9 6.5, 10 4.5", "thin"),
    line("M -11.5 3.5 Q 0 -9.5 11.5 3.5", "thick"),
    line("M -11.5 3.5 L 0 8.5 L 11.5 3.5", "thin"),
    ...arrow,
    fill("circle", { cy: -2.5, r: gem ? 2.8 : 2 }),
  ];
  if (gem) shown.push(hole("circle", { cy: -2.5, r: 1.3 }));
  return [group("rotate(-45)", ...shown)];
}

/** A caster: a staff with an orb on top; the big staff holds the orb in two prongs, the gem shines in the orb. */
function staff(big: boolean, gem: boolean): SVGElement[] {
  if (!big) return [group("rotate(-25) scale(0.85)", line("M 0 12 L 0 -4", "thick"), fill("circle", { cy: -7.5, r: 3.6 }))];
  const shown: SVGElement[] = [
    line("M 0 13 L 0 -4", "thick"),
    line("M 0 -3.5 C -4.5 -4, -5 -9, -2.5 -12.5 M 0 -3.5 C 4.5 -4, 5 -9, 2.5 -12.5"),
    fill("circle", { cy: -8.3, r: 3.4 }),
    fill("rect", { x: -2.4, y: 4, width: 4.8, height: 1.8, rx: 0.9 }),
  ];
  if (gem) shown.push(hole("circle", { cy: -8.3, r: 1.5 }));
  return [group("rotate(-25)", ...shown)];
}

/** A five-pointed star with its centre at (x, y). */
function star(x: number, y: number, radius: number): SVGElement {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`);
  }
  return fill("polygon", { points: points.join(" ") });
}

// ---------------------------------------------------------------------------
// Monsters
//
// One picture per type. Lotte's Barbara and Mark look like Tessa's: the
// badge and the details card already say which one it is.

const MONSTER_ART: Record<MonsterTypeId, () => SVGElement[]> = {
  basic: blob,
  rat,
  guard: helmet,
  archer: arrow,
  brute: club,
  tessa: () => crown(false),
  barbara: axe,
  mark: slingshot,
  wolf,
  sentry: spear,
  crossbowman: crossbow,
  ogre,
  lotte: () => crown(true),
  lottesBarbara: axe,
  lottesMark: slingshot,
};

/** The basic monster: a horned blob with a wavy bottom, two eyes and a grin. */
function blob(): SVGElement[] {
  return [
    fill("path", { d: "M -6 -4.5 C -8.5 -8, -8.5 -11, -6.5 -12.5 C -6 -9.5, -4.5 -7.5, -2.5 -6.2 Z" }),
    fill("path", { d: "M 6 -4.5 C 8.5 -8, 8.5 -11, 6.5 -12.5 C 6 -9.5, 4.5 -7.5, 2.5 -6.2 Z" }),
    fill("path", { d: "M -9.5 9 C -11.5 2, -9.5 -6.5, 0 -6.5 C 9.5 -6.5, 11.5 2, 9.5 9 C 6.5 7.5, 3 10, 0 8.5 C -3 10, -6.5 7.5, -9.5 9 Z" }),
    hole("circle", { cx: -3.6, cy: -0.5, r: 1.7 }),
    hole("circle", { cx: 3.6, cy: -0.5, r: 1.7 }),
    groove("M -4 3.5 Q 0 6.5 4 3.5"),
  ];
}

/**
 * A rat seen from the side, facing left: a body with a pointed snout, a
 * large round ear, two feet and a long thin tail curling under it. Eye,
 * nose and the inside of the ear are holes.
 */
function rat(): SVGElement[] {
  return [
    line("M 8.5 4 C 13 6, 13 11, 8 11.5 C 5 11.8, 2 11, 0 10.5"),
    fill("path", {
      d: "M -13.5 2 C -11 0, -8 -3.5, -3.5 -4.5 C 2 -6.5, 9 -4.5, 10 0.5 C 11 5, 7 7, 2 7 L -5 7 C -8 6, -10 4, -13.5 2 Z",
    }),
    fill("ellipse", { cx: -3.5, cy: -5.5, rx: 2.6, ry: 3.4, transform: "rotate(-15 -3.5 -5.5)" }),
    hole("ellipse", { cx: -3.5, cy: -5.5, rx: 1.2, ry: 1.9, transform: "rotate(-15 -3.5 -5.5)" }),
    hole("circle", { cx: -7.5, cy: -0.3, r: 1.1 }),
    hole("circle", { cx: -13.3, cy: 2, r: 1 }),
    line("M -4 7 l -1 2.5 M 4 7 l 1 2.5"),
  ];
}

/** A guard: a closed helmet seen from the front, with a T-shaped slit. */
function helmet(): SVGElement[] {
  return [
    fill("path", { d: "M -9 10 L -9 -2 C -9 -8.5, -4.5 -11.5, 0 -11.5 C 4.5 -11.5, 9 -8.5, 9 -2 L 9 10 Z" }),
    groove("M 0 -11 L 0 -5"),
    hole("rect", { x: -7, y: -3.5, width: 14, height: 2.6, rx: 1.1 }),
    hole("rect", { x: -1.3, y: -3.5, width: 2.6, height: 10, rx: 1.1 }),
  ];
}

/** An archer: a single arrow, pointing to the top left. */
function arrow(): SVGElement[] {
  return [
    group(
      "rotate(-45)",
      line("M 0 10 L 0 -8", "thick"),
      fill("path", { d: "M 0 -14 L -4 -7 L 4 -7 Z" }),
      fill("path", { d: "M -0.6 5 L -4 8.5 L -4 13 L -0.6 9.5 Z" }),
      fill("path", { d: "M 0.6 5 L 4 8.5 L 4 13 L 0.6 9.5 Z" }),
    ),
  ];
}

/** A brute: a big spiked club. */
function club(): SVGElement[] {
  return [
    group(
      "rotate(-40)",
      line("M 0 13 L 0 2", "thick"),
      fill("path", { d: "M -1.8 4 L -4.8 -8 C -5 -13, 5 -13, 4.8 -8 L 1.8 4 Z" }),
      fill("path", { d: "M -4.4 -7 L -7.5 -7.5 L -4.6 -9.5 Z M 4.4 -7 L 7.5 -7.5 L 4.6 -9.5 Z" }),
      fill("path", { d: "M -3.6 -2 L -6.5 -2.3 L -3.9 -4.3 Z M 3.6 -2 L 6.5 -2.3 L 3.9 -4.3 Z" }),
      fill("path", { d: "M -1.5 -11.6 L 0 -14.5 L 1.5 -11.6 Z" }),
    ),
  ];
}

/** A wolf: its head from the front, with pointed ears, slanted eyes and a long snout. */
function wolf(): SVGElement[] {
  return [
    fill("path", {
      d: "M -10 -12 L -4 -6 L 4 -6 L 10 -12 L 10 -2 C 9.5 2, 6 4.5, 3.5 6 L 2.5 10.5 L -2.5 10.5 L -3.5 6 C -6 4.5, -9.5 2, -10 -2 Z",
    }),
    hole("path", { d: "M -8 -8 L -5.5 -6 L -7.8 -4.5 Z M 8 -8 L 5.5 -6 L 7.8 -4.5 Z" }),
    hole("ellipse", { cx: -4.3, cy: -1, rx: 2, ry: 1, transform: "rotate(25 -4.3 -1)" }),
    hole("ellipse", { cx: 4.3, cy: -1, rx: 2, ry: 1, transform: "rotate(-25 4.3 -1)" }),
    hole("ellipse", { cy: 8.7, rx: 1.8, ry: 1.2 }),
  ];
}

/** A sentry: a spear with a leaf-shaped blade, pointing to the top left. */
function spear(): SVGElement[] {
  return [
    group(
      "rotate(-45)",
      line("M 0 13 L 0 -5", "thick"),
      fill("path", { d: "M 0 -14.5 C 3.2 -10.5, 3.2 -7, 0 -4 C -3.2 -7, -3.2 -10.5, 0 -14.5 Z" }),
      fill("rect", { x: -3.5, y: -4.6, width: 7, height: 1.8, rx: 0.9 }),
      groove("M 0 -12 L 0 -6"),
    ),
  ];
}

/** A crossbowman: a crossbow seen from above, with a bolt, pointing up. */
function crossbow(): SVGElement[] {
  return [
    fill("rect", { x: -1.8, y: -5, width: 3.6, height: 17, rx: 1.2 }),
    line("M -11 -1 Q 0 -9 11 -1", "thick"),
    line("M -11 -1 L 0 2 L 11 -1", "thin"),
    line("M 0 2 L 0 -10"),
    fill("path", { d: "M 0 -13.5 L -2.4 -9 L 2.4 -9 Z" }),
    hole("rect", { x: -0.5, y: 4, width: 1, height: 6 }),
  ];
}

/** An ogre: a big round face with a heavy brow, small eyes and two tusks. */
function ogre(): SVGElement[] {
  return [
    fill("path", { d: "M -11.5 -1 C -11.5 -8.5, -6 -11.5, 0 -11.5 C 6 -11.5, 11.5 -8.5, 11.5 -1 C 11.5 6, 7 11, 0 11 C -7 11, -11.5 6, -11.5 -1 Z" }),
    groove("M -8 -5 L -2 -3.2 M 8 -5 L 2 -3.2"),
    hole("circle", { cx: -4.5, cy: -1, r: 1.4 }),
    hole("circle", { cx: 4.5, cy: -1, r: 1.4 }),
    hole("path", { d: "M -7 3 Q 0 6 7 3 L 6 6.5 Q 0 10 -6 6.5 Z" }),
    fill("path", { d: "M -5.3 6.4 L -4.4 1.2 L -3.1 6.9 Z M 5.3 6.4 L 4.4 1.2 L 3.1 6.9 Z" }),
  ];
}

/** Barbara: a battle axe with a curved blade. */
function axe(): SVGElement[] {
  return [
    group(
      "rotate(-20)",
      line("M 0 13 L 0 -12", "thick"),
      fill("path", { d: "M 0.5 -9.5 C 4 -9.5, 7 -11.5, 9.5 -13 C 12 -8.5, 12 -1.5, 9.5 3 C 7 1.5, 4 -0.5, 0.5 -0.5 Z" }),
      fill("path", { d: "M -0.5 -7 L -4.5 -6 L -0.5 -3 Z" }),
    ),
  ];
}

/** Mark: a slingshot, its band pulled back with a stone in it. */
function slingshot(): SVGElement[] {
  return [
    line("M 0 13 L 0 2", "thick"),
    line("M 0 2.5 C -1 -1, -6.5 -2, -6.5 -10 M 0 2.5 C 1 -1, 6.5 -2, 6.5 -10", "thick"),
    line("M -6.5 -9 L -1.5 -1 M 6.5 -9 L 1.5 -1", "thin"),
    fill("circle", { cy: -1, r: 2.6 }),
  ];
}

/**
 * A boss: a crown. Tessa's has three points; Lotte's, the last boss, is
 * bigger, with five points and three gems in its band.
 */
function crown(grand: boolean): SVGElement[] {
  if (!grand) {
    return [
      fill("path", { d: "M -10 7 L -10 -5 L -5 0.5 L 0 -8.5 L 5 0.5 L 10 -5 L 10 7 Z" }),
      fill("circle", { cx: -10, cy: -6.5, r: 1.7 }),
      fill("circle", { cy: -10, r: 1.7 }),
      fill("circle", { cx: 10, cy: -6.5, r: 1.7 }),
      groove("M -10 3.5 L 10 3.5"),
    ];
  }
  return [
    group(
      "translate(0 1) scale(0.92)",
      fill("path", { d: "M -12 8 L -12 -4 L -9 1 L -6 -8 L -3 0 L 0 -11 L 3 0 L 6 -8 L 9 1 L 12 -4 L 12 8 Z" }),
      fill("circle", { cx: -12, cy: -5.3, r: 1.5 }),
      fill("circle", { cx: -6, cy: -9.4, r: 1.5 }),
      fill("circle", { cy: -12.5, r: 1.7 }),
      fill("circle", { cx: 6, cy: -9.4, r: 1.5 }),
      fill("circle", { cx: 12, cy: -5.3, r: 1.5 }),
      groove("M -12 2.2 L 12 2.2"),
      hole("circle", { cx: -6, cy: 5.2, r: 1.5 }),
      hole("rect", { x: -1.7, y: 3.5, width: 3.4, height: 3.4, transform: "rotate(45 0 5.2)" }),
      hole("circle", { cx: 6, cy: 5.2, r: 1.5 }),
    ),
  ];
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
