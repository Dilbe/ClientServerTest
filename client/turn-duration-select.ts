// The turn duration list, for the host: in the party before the start, and
// on the game screen during the game (design.md, Turns; issue #372).

import { describeTurnDuration, TURN_DURATION_IDS } from "../shared/turn-durations.ts";

/** Fills a list with every turn duration, once: the choices never change. */
export function fillTurnDurations(select: HTMLSelectElement): void {
  for (const id of TURN_DURATION_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = describeTurnDuration(id);
    select.append(option);
  }
}
