// Drawing the hex map with SVG (architecture.md, Client and shared code).
//
// SVG is a picture described as elements, like HTML: each hex is its own
// <polygon>, so it can be tapped directly, and the browser scales the
// whole picture sharply to any screen. The positions below are in SVG "user
// units"; the `viewBox` attribute maps them onto however many pixels the
// <svg> element gets on screen, so the maths never needs the screen size.

import { neighbours, type Hex } from "../shared/rules/hex.ts";
import type { ViewBox } from "./map-view.ts";

/** Centre to corner of one hex, in user units. */
export const HEX_SIZE = 30;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The centre of a hex. Flat-topped hexes in axial coordinates (see
 * shared/rules/hex.ts): each column is 1.5 hex sizes to the right of the
 * previous one, and each step of r is one hex height (√3 sizes) down. Half a
 * step of r per column gives the half-hex shift between columns.
 */
export function hexCentre(h: Hex): { x: number; y: number } {
  return {
    x: HEX_SIZE * 1.5 * h.q,
    y: HEX_SIZE * Math.sqrt(3) * (h.r + h.q / 2),
  };
}

/** The six corners of a hex, as an SVG `points` attribute. A flat top means corners at 0°, 60°, 120°, ... */
export function hexCorners(h: Hex): string {
  const { x, y } = hexCentre(h);
  return cornersAround(x, y, HEX_SIZE);
}

/**
 * Creates an SVG element. SVG elements need their own namespace:
 * `document.createElement("circle")` would make an unknown *HTML* element
 * that draws nothing.
 */
export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** The corners of a hex of `size` around a centre, as an SVG `points` attribute. */
function cornersAround(x: number, y: number, size: number): string {
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push(`${(x + size * Math.cos(angle)).toFixed(2)},${(y + size * Math.sin(angle)).toFixed(2)}`);
  }
  return corners.join(" ");
}

/**
 * A number from 0 to 255 that belongs to a hex: always the same for the same
 * hex, but different between neighbours. It picks the shade of a floor tile
 * and where the cracks are, so the floor doesn't look flat, yet a dungeon
 * always looks the same (nothing in the game is random, design.md, Vision).
 * The multiplications mix the bits of q and r (a "hash", like
 * GetHashCode in .NET).
 */
function hexNoise(h: Hex): number {
  let n = Math.imul(h.q, 374761393) ^ Math.imul(h.r, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) & 0xff;
}

/** How far a tile is drawn from its centre: a little less than the hex, so the dark joints between tiles show. */
const TILE_SIZE = HEX_SIZE * 0.93;

/**
 * The stone floor tile of a hex (design.md, Dungeons): one of four shades,
 * and on some tiles a thin crack. Only a picture: taps go to the hex polygon
 * on top of it (see `drawHexes`).
 */
export function floorTile(h: Hex): SVGGElement {
  const noise = hexNoise(h);
  const { x, y } = hexCentre(h);
  const tile = svgElement("g", { class: `tile shade-${noise % 4}` });
  tile.append(svgElement("polygon", { class: "stone", points: cornersAround(x, y, TILE_SIZE) }));
  // A lighter edge along the top: the light falls from above.
  tile.append(svgElement("polyline", { class: "edge", points: cornersAround(x, y, TILE_SIZE - 1.5).split(" ").slice(3, 6).join(" ") }));
  if (noise % 3 === 0) {
    // A crack from near the centre towards one of the corners, with a kink.
    const angle = (Math.PI / 3) * (noise % 6) + 0.3;
    const kink = angle + ((noise & 16) ? 0.5 : -0.5);
    const p = (r: number, a: number) => `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`;
    tile.append(svgElement("polyline", { class: "crack", points: `${p(HEX_SIZE * 0.15, angle + Math.PI)} ${p(HEX_SIZE * 0.35, kink)} ${p(HEX_SIZE * 0.75, angle)}` }));
  }
  return tile;
}

/**
 * A wall hex: a hex next to the map that isn't part of it. Drawn as a raised
 * block of dark stone, with a lighter top and two lines of bricks. Only a
 * picture: walls can't be tapped and change no rules.
 */
function wallBlock(h: Hex): SVGGElement {
  const { x, y } = hexCentre(h);
  const block = svgElement("g", { class: "wall" });
  block.append(
    svgElement("polygon", { class: "side", points: cornersAround(x, y, HEX_SIZE) }),
    svgElement("polygon", { class: "top", points: cornersAround(x, y - 3, HEX_SIZE * 0.8) }),
  );
  // Brick joints on the top: two rows, the joints of the second row shifted.
  const h3 = HEX_SIZE * 0.8 * (Math.sqrt(3) / 2);
  const joints = [
    `M${x - HEX_SIZE * 0.6} ${y - 3} H${x + HEX_SIZE * 0.6}`,
    `M${x} ${y - 3 - h3} V${y - 3}`,
    `M${x - HEX_SIZE * 0.3} ${y - 3} V${y - 3 + h3}`,
    `M${x + HEX_SIZE * 0.3} ${y - 3} V${y - 3 + h3}`,
  ];
  block.append(svgElement("path", { class: "joints", d: joints.join(" ") }));
  return block;
}

/** Half the width of a flat-topped hex of `size` at height `dy` from its centre. */
function halfWidthAt(size: number, dy: number): number {
  return size - Math.abs(dy) / Math.sqrt(3);
}

/**
 * The picture of a door. It holds both looks, and the class "closed" on
 * the group picks one (see `setDoorClosed`): closed, a wooden door of
 * planks with two iron bands, which blocks the way; open, only its frame
 * is left around the floor.
 */
function doorArt(h: Hex): SVGGElement {
  const { x, y } = hexCentre(h);
  const size = HEX_SIZE * 0.9;
  const art = svgElement("g", { class: "door-art", "data-q": h.q, "data-r": h.r });

  const closed = svgElement("g", { class: "door-closed" });
  closed.append(svgElement("polygon", { class: "wood", points: cornersAround(x, y, size) }));
  // The joints between the planks: vertical lines, cut off at the hex's edge.
  const planks: string[] = [];
  for (const dx of [-0.5, 0, 0.5].map((f) => f * size)) {
    const dy = Math.min(size * (Math.sqrt(3) / 2), Math.sqrt(3) * (size - Math.abs(dx)));
    planks.push(`M${x + dx} ${y - dy + 1} V${y + dy - 1}`);
  }
  closed.append(svgElement("path", { class: "planks", d: planks.join(" ") }));
  const bands: string[] = [];
  for (const dy of [-0.42, 0.42].map((f) => f * size)) {
    const w = halfWidthAt(size, dy) - 1;
    bands.push(`M${x - w} ${y + dy} H${x + w}`);
  }
  closed.append(svgElement("path", { class: "bands", d: bands.join(" ") }));
  closed.append(svgElement("circle", { class: "handle", cx: x + size * 0.28, cy: y, r: 2.6 }));

  const open = svgElement("g", { class: "door-open" });
  open.append(svgElement("polygon", { class: "frame", points: cornersAround(x, y, size) }));

  art.append(closed, open);
  return art;
}

/**
 * Draws the map's hexes into `svg`, replacing what was there, and returns
 * the box around them and their walls, for the viewBox (map-view.ts sets it).
 * Start hexes get the class "start", doors the class "door" (whether a door
 * is closed changes during the game, so the game screen marks that itself,
 * with `setDoorClosed`). Each hex remembers its coordinates in `data-q` and
 * `data-r`, so a tap can be traced back to it (see `hexAt`).
 *
 * The picture has nine layers, drawn in this order (later ones on top):
 * the walls ("g.walls"), the floor tiles ("g.floor"), the doors
 * ("g.doors"), the hexes ("g.hexes"), the walls characters created
 * ("g.created-walls"), the rangers' traps ("g.traps"), the plans
 * ("g.plans"), the monster preview ("g.preview") and the tokens ("g.tokens").
 *
 * The walls, floor and doors are only a picture. The hex polygons on top of
 * them are transparent and take the taps; the highlights (a hex that can be
 * tapped, an alert range, ...) colour those polygons, so they lie over the
 * floor and the doors.
 */
export function drawHexes(
  svg: SVGSVGElement,
  hexes: readonly Hex[],
  startHexes: readonly Hex[],
  doors: readonly Hex[],
): ViewBox {
  const onMap = new Set(hexes.map((h) => `${h.q},${h.r}`));
  const isStart = new Set(startHexes.map((h) => `${h.q},${h.r}`));
  const isDoor = new Set(doors.map((h) => `${h.q},${h.r}`));

  // The walls: every hex next to the map that isn't on it.
  const walls = new Map<string, Hex>();
  for (const h of hexes) {
    for (const n of neighbours(h)) {
      const key = `${n.q},${n.r}`;
      if (!onMap.has(key)) walls.set(key, n);
    }
  }

  const wallLayer = svgElement("g", { class: "walls" });
  for (const h of walls.values()) wallLayer.append(wallBlock(h));
  const floorLayer = svgElement("g", { class: "floor" });
  const doorLayer = svgElement("g", { class: "doors" });
  const layer = svgElement("g", { class: "hexes" });
  for (const h of hexes) {
    const key = `${h.q},${h.r}`;
    floorLayer.append(floorTile(h));
    if (isDoor.has(key)) doorLayer.append(doorArt(h));
    layer.append(
      svgElement("polygon", {
        points: hexCorners(h),
        class: isStart.has(key) ? "hex start" : isDoor.has(key) ? "hex door" : "hex",
        "data-q": h.q,
        "data-r": h.r,
      }),
    );
  }

  // The smallest box around all hexes and walls. The walls at the edge are
  // cut off a little, so the map itself gets more room.
  const centres = [...hexes, ...walls.values()].map(hexCentre);
  const margin = HEX_SIZE * 0.6;
  const minX = Math.min(...centres.map((c) => c.x)) - margin;
  const minY = Math.min(...centres.map((c) => c.y)) - margin;
  const width = Math.max(...centres.map((c) => c.x)) + margin - minX;
  const height = Math.max(...centres.map((c) => c.y)) + margin - minY;

  svg.replaceChildren(
    wallLayer,
    floorLayer,
    doorLayer,
    layer,
    svgElement("g", { class: "created-walls" }),
    svgElement("g", { class: "traps" }),
    svgElement("g", { class: "plans" }),
    svgElement("g", { class: "preview" }),
    svgElement("g", { class: "tokens" }),
  );
  return { x: minX, y: minY, width, height };
}

/**
 * Shows a door drawn by `drawHexes` as closed (planks) or open (its frame).
 * The hex polygon gets the class "closed" too, so a highlight on it can
 * tell the two apart.
 */
export function setDoorClosed(svg: SVGSVGElement, h: Hex, closed: boolean): void {
  hexElement(svg, h)?.classList.toggle("closed", closed);
  svg.querySelector(`g.door-art[data-q="${h.q}"][data-r="${h.r}"]`)?.classList.toggle("closed", closed);
}

/** The polygon of a hex drawn by `drawHexes`, if the hex is on the map. */
export function hexElement(svg: SVGSVGElement, h: Hex): SVGPolygonElement | null {
  return svg.querySelector<SVGPolygonElement>(`polygon.hex[data-q="${h.q}"][data-r="${h.r}"]`);
}

/**
 * The hex that a click or tap landed on, if it landed on one. Tokens and plan
 * markers let taps through to the hex below them (see style.css), so tapping
 * a monster finds the hex it stands on.
 */
export function hexAt(target: EventTarget | null): Hex | undefined {
  if (!(target instanceof SVGPolygonElement) || !target.classList.contains("hex")) return undefined;
  return { q: Number(target.dataset.q), r: Number(target.dataset.r) };
}
