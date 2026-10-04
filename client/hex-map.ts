// Drawing the hex map with SVG (architecture.md, Client and shared code).
//
// SVG is a picture described as elements, like HTML: each hex is its own
// <polygon>, so it can be tapped directly, and the browser scales the
// whole picture sharply to any screen. The positions below are in SVG "user
// units"; the `viewBox` attribute maps them onto however many pixels the
// <svg> element gets on screen, so the maths never needs the screen size.

import type { Hex } from "../shared/rules/hex.ts";

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
function hexCorners(h: Hex): string {
  const { x, y } = hexCentre(h);
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push(`${(x + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(y + HEX_SIZE * Math.sin(angle)).toFixed(2)}`);
  }
  return corners.join(" ");
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

/**
 * Draws the map's hexes into `svg`, replacing what was there, and sizes the
 * picture to fit them. Start hexes get the class "start". Each hex remembers
 * its coordinates in `data-q` and `data-r`, so a tap can be traced back to it
 * (see `hexAt`).
 *
 * The picture has four layers, drawn in this order (later ones on top):
 * the hexes, the plans ("g.plans"), the monster preview ("g.preview") and
 * the tokens ("g.tokens").
 */
export function drawHexes(svg: SVGSVGElement, hexes: readonly Hex[], startHexes: readonly Hex[]): void {
  const isStart = new Set(startHexes.map((h) => `${h.q},${h.r}`));
  const layer = svgElement("g", { class: "hexes" });
  for (const h of hexes) {
    layer.append(
      svgElement("polygon", {
        points: hexCorners(h),
        class: isStart.has(`${h.q},${h.r}`) ? "hex start" : "hex",
        "data-q": h.q,
        "data-r": h.r,
      }),
    );
  }

  // The smallest box around all hexes, with a little room for the outlines.
  const centres = hexes.map(hexCentre);
  const margin = HEX_SIZE + 2;
  const minX = Math.min(...centres.map((c) => c.x)) - margin;
  const minY = Math.min(...centres.map((c) => c.y)) - margin;
  const width = Math.max(...centres.map((c) => c.x)) + margin - minX;
  const height = Math.max(...centres.map((c) => c.y)) + margin - minY;
  svg.setAttribute("viewBox", `${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`);

  svg.replaceChildren(
    layer,
    svgElement("g", { class: "plans" }),
    svgElement("g", { class: "preview" }),
    svgElement("g", { class: "tokens" }),
  );
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
