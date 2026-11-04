// A small, fixed picture of a dungeon's map for the lobby (design.md,
// Parties and the lobby): the "Party" screen shows the chosen dungeon's map,
// and "Choose a dungeon" a thumbnail of each one.
//
// It is drawn with the same code as the game map (hex-map.ts), so hexes,
// start hexes and doors look the same. Unlike the game map it can't be
// tapped, zoomed or moved: the viewBox is simply the box around the hexes,
// and the browser scales that to the size style.css gives the <svg>.

import { sleepsAtStart, type DungeonMap } from "../shared/rules/dungeon-map.ts";
import { MONSTER_TYPES } from "../shared/rules/stats.ts";
import { drawHexes, hexCentre, hexElement, HEX_SIZE, svgElement } from "./hex-map.ts";

/** Creates a new <svg> with a preview of `map`. */
export function mapPreview(map: DungeonMap, className: string): SVGSVGElement {
  const svg = svgElement("svg", { class: `map-preview ${className}`, "aria-hidden": "true" });
  drawMapPreview(svg, map);
  return svg;
}

/**
 * Draws a preview of `map` into `svg`, replacing what was there: the map as
 * it is at the start of a game, with every door closed and the monsters
 * where they stand. A monster that starts asleep or on guard is greyed out,
 * as in the game.
 */
export function drawMapPreview(svg: SVGSVGElement, map: DungeonMap): void {
  const bounds = drawHexes(svg, map.hexes, map.startHexes, map.doors);
  for (const door of map.doors) hexElement(svg, door)?.classList.add("closed");

  const monsters = svg.querySelector("g.tokens")!;
  for (const m of map.monsters) {
    const asleep = MONSTER_TYPES[m.type].alertRange !== undefined || sleepsAtStart(map, m.position);
    const { x, y } = hexCentre(m.position);
    monsters.append(
      svgElement("circle", {
        cx: x,
        cy: y,
        r: HEX_SIZE * 0.55,
        class: asleep ? "preview-monster asleep" : "preview-monster",
      }),
    );
  }

  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
}
