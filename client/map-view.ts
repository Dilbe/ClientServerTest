// Zooming and moving the map on its own, without zooming the page (design.md, Mobile).
//
// The map is an SVG picture, and its `viewBox` attribute says which part of
// the picture fills the <svg> element (see hex-map.ts). Zooming in is
// showing a smaller part of the picture in the same element, and moving is
// shifting that part, so both only change the viewBox: nothing is redrawn.
//
// The <svg> element has the same size for every dungeon (style.css), so the
// part in view always gets the element's shape, not the dungeon's: a wide,
// low dungeon zoomed in still fills the whole map area. What this class
// remembers is the zoom (screen pixels per picture unit) and the picture
// point in the middle of the map area; the viewBox follows from those and
// the element's size whenever one of them changes. That is also what keeps
// the zoom and position when the phone is rotated or the window resized.
//
// Input arrives as "pointer events": one kind of event for mouse, finger
// and pen alike, each with a `pointerId`. Two fingers on the screen are two
// pointers with their own ids, which is how a pinch is told apart from a
// drag. In WinForms terms, it is MouseDown/MouseMove/MouseUp, but with one
// "mouse" per finger.
//
// The CSS rule `touch-action: none` on the map (style.css) tells the
// browser not to pan or zoom the page for touches that start on the map,
// so these events are ours to handle. Touches elsewhere still zoom the page
// as usual, which matters for players who need to enlarge everything.
//
// A finger held still on the map for LONG_PRESS_MS is a long press
// (design.md, The details card): it shows a token without planning
// anything, so the click that may follow it is ignored, like the one after a
// drag. The phone's own long press (selecting text, a context menu) is
// turned off on the map: in style.css, and by cancelling the `contextmenu`
// event below. That only happens for a finger or pen: a right click with the
// mouse still opens the browser's menu as usual.

/** A part of the picture, in SVG user units, as in the `viewBox` attribute. */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Zooming in stops when this much of the picture is still in view across: about five hex columns. */
const MIN_WIDTH = 230;
/**
 * A new game shows the whole dungeon only if its hexes are then at least
 * this many pixels per picture unit: a hex is 60 units across (hex-map.ts),
 * so this is about 60 pixels, comfortably above the 44 pixel tap size.
 * Otherwise it starts zoomed in to this.
 */
const START_SCALE = 1;
/** A touch or mouse press that moves further than this, in screen pixels, is a drag, not a tap. */
const DRAG_PIXELS = 8;
/** How long a finger has to stay still on the map for a long press. */
const LONG_PRESS_MS = 500;
/** How much one notch of the mouse wheel zooms (100 pixels of `deltaY` is a typical notch). */
const WHEEL_ZOOM_PER_PIXEL = 0.002;

export class MapView {
  private readonly svg: SVGSVGElement;
  private readonly fitButton: HTMLButtonElement;
  /** The whole dungeon: the most that needs to be in view. */
  private fit: ViewBox = { x: 0, y: 0, width: 1, height: 1 };
  /** The size of the map area in screen pixels; 0 while the game screen is hidden. */
  private size = { width: 0, height: 0 };
  /**
   * The zoom, in screen pixels per picture unit, and the picture point in
   * the middle of the map area. `undefined` until the starting view is
   * chosen, which needs the size of the map area, so it waits until the
   * game screen is shown.
   */
  private view: { scale: number; centre: Point } | undefined;
  /** Whether the whole dungeon is in view, so a resize shows it whole again rather than keeping the zoom. */
  private showingAll = true;
  /** Where the starting view looks when it zooms in: the middle of the start hexes. */
  private startFocus: Point = { x: 0, y: 0 };

  /** Where each pointer that is down was last seen, in screen pixels. */
  private readonly pointers = new Map<number, Point>();
  /** Where the first pointer of this press went down, to measure the drag threshold against. */
  private pressStart: Point | undefined;
  /** Whether the current (or last) press moved or pinched the map, so it isn't a tap. */
  private dragged = false;
  /** Whether the current (or last) press was a long press, so it isn't a tap either. */
  private longPressed = false;
  /** Fires the long press, unless the press ends or moves first. */
  private longPressTimer: number | undefined;
  /** Whether the last press was with a finger or pen, whose context menu is ours to turn off. */
  private touching = false;
  /** Called with the element under the finger when a long press happens. */
  private readonly onLongPress: (target: EventTarget | null) => void;

  constructor(svg: SVGSVGElement, fitButton: HTMLButtonElement, onLongPress: (target: EventTarget | null) => void) {
    this.svg = svg;
    this.fitButton = fitButton;
    this.onLongPress = onLongPress;
    svg.addEventListener("pointerdown", (event) => this.pointerDown(event));
    svg.addEventListener("contextmenu", (event) => {
      if (this.touching) event.preventDefault();
    });
    // Moves and releases are watched on the whole window, so a drag goes on
    // when the pointer leaves the map. Only pointers that went down on the
    // map count (see `pointers`).
    window.addEventListener("pointermove", (event) => this.pointerMove(event));
    window.addEventListener("pointerup", (event) => this.pointerUp(event));
    window.addEventListener("pointercancel", (event) => this.pointerUp(event));
    // `passive: false` promises the browser we may call preventDefault, which
    // stops the page from scrolling. Without it the browser may scroll
    // before our handler has even run.
    svg.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    fitButton.addEventListener("click", () => this.showAll());
    // A ResizeObserver calls back whenever the element's size changes: the
    // phone is rotated, the window resized, or the game screen shown (a
    // hidden element has size 0). Like a control's Resize event in WinForms,
    // but for any element and whatever caused it.
    new ResizeObserver(() => this.resized()).observe(svg);
  }

  /**
   * Whether the last press was a drag, a pinch or a long press. The browser
   * can still fire a `click` after one, so the map's click handler asks this
   * to ignore it.
   */
  get wasNoTap(): boolean {
    return this.dragged || this.longPressed;
  }

  /**
   * Sets the box around the whole dungeon and the middle of its start hexes.
   * `keepView` keeps the current zoom and position, for a new snapshot of
   * the same game (after a reconnect, say); otherwise the starting view is
   * chosen again (see `startView`).
   */
  setBounds(fit: ViewBox, startFocus: Point, keepView: boolean): void {
    this.fit = fit;
    this.startFocus = startFocus;
    if (!keepView) this.view = undefined;
    this.render();
  }

  /** Shows the whole dungeon again (the "Fit" button). */
  showAll(): void {
    this.set(this.fitScale(), middleOf(this.fit));
  }

  private resized(): void {
    const rect = this.svg.getBoundingClientRect();
    this.size = { width: rect.width, height: rect.height };
    // The whole dungeon stays in view; any other zoom and position are kept.
    if (this.showingAll && this.view) this.view = { scale: this.fitScale(), centre: middleOf(this.fit) };
    this.render();
  }

  /**
   * The starting view of a new game: the whole dungeon if its hexes are then
   * big enough to tap, otherwise zoomed in to that size around the start hexes.
   */
  private startView(): { scale: number; centre: Point } {
    const fitScale = this.fitScale();
    if (fitScale >= START_SCALE) return { scale: fitScale, centre: middleOf(this.fit) };
    return { scale: START_SCALE, centre: this.startFocus };
  }

  /** The zoom that just shows the whole dungeon: the smallest one allowed. */
  private fitScale(): number {
    return Math.min(this.size.width / this.fit.width, this.size.height / this.fit.height);
  }

  /** The largest zoom allowed: about five hex columns across, unless the whole dungeon is narrower. */
  private maxScale(): number {
    return Math.max(this.size.width / MIN_WIDTH, this.fitScale());
  }

  private pointerDown(event: PointerEvent): void {
    this.touching = event.pointerType !== "mouse";
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // The first finger (or the mouse) starts a new press. Forgetting the old
    // pointers here means one whose "up" never arrived can't linger.
    if (event.isPrimary) this.pointers.clear();
    if (this.pointers.size === 0) {
      this.pressStart = { x: event.clientX, y: event.clientY };
      this.dragged = false;
      this.longPressed = false;
      // Only for a finger or pen: with a mouse, hovering does the same.
      if (this.touching) {
        const target = event.target;
        this.longPressTimer = window.setTimeout(() => {
          this.longPressed = true;
          this.onLongPress(target);
        }, LONG_PRESS_MS);
      }
    } else {
      // A second finger: this is a pinch, so the press is no tap.
      this.dragged = true;
      this.cancelLongPress();
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  private pointerMove(event: PointerEvent): void {
    const last = this.pointers.get(event.pointerId);
    if (!last) return; // A mouse moving over the map without a button down.
    const now = { x: event.clientX, y: event.clientY };

    if (!this.dragged && this.pressStart) {
      if (Math.hypot(now.x - this.pressStart.x, now.y - this.pressStart.y) < DRAG_PIXELS) return;
      this.dragged = true;
      this.cancelLongPress();
    }

    if (this.pointers.size === 1) {
      this.moveBy(last, now);
    } else {
      // A pinch: zoom by how much the two fingers spread, around the point
      // between them, and move by how much that point moved.
      const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      if (!other) return;
      const before = middle(last, other);
      const after = middle(now, other);
      const spread = distance(now, other) / Math.max(distance(last, other), 1);
      this.zoomAt(before, spread);
      this.moveBy(before, after);
    }
    this.pointers.set(event.pointerId, now);
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    this.cancelLongPress();
    // `dragged` and `longPressed` stay set until the next press, for the click that follows.
  }

  private cancelLongPress(): void {
    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = undefined;
  }

  private wheel(event: WheelEvent): void {
    // deltaMode 1 means the delta is in lines rather than pixels (Firefox, some mice).
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const before = this.view;
    this.zoomAt({ x: event.clientX, y: event.clientY }, Math.exp(-pixels * WHEEL_ZOOM_PER_PIXEL));
    // Only take the wheel from the page when the map zoomed: at the limit,
    // scrolling on goes back to scrolling the page.
    if (this.view !== before) event.preventDefault();
  }

  /** Zooms in by `factor` (below 1 zooms out), keeping the picture under `screen` where it is. */
  private zoomAt(screen: Point, factor: number): void {
    if (!this.view) return;
    const { scale, centre } = this.view;
    const newScale = clamp(scale * factor, this.fitScale(), this.maxScale());
    const anchor = this.toPicture(screen);
    const keep = scale / newScale;
    this.set(newScale, { x: anchor.x - (anchor.x - centre.x) * keep, y: anchor.y - (anchor.y - centre.y) * keep });
  }

  /** Moves the picture along with a pointer that went from `from` to `to` on screen. */
  private moveBy(from: Point, to: Point): void {
    if (!this.view) return;
    const { scale, centre } = this.view;
    this.set(scale, { x: centre.x + (from.x - to.x) / scale, y: centre.y + (from.y - to.y) / scale });
  }

  /**
   * A screen point in picture units. The viewBox always has the element's
   * shape (see `render`), so this is just the distance from the middle of
   * the element, scaled.
   */
  private toPicture(screen: Point): Point {
    const rect = this.svg.getBoundingClientRect();
    const { scale, centre } = this.view!;
    return {
      x: centre.x + (screen.x - rect.left - rect.width / 2) / scale,
      y: centre.y + (screen.y - rect.top - rect.height / 2) / scale,
    };
  }

  /**
   * Shows the picture at `scale` around `centre`, kept within the zoom limits
   * and inside the dungeon, so the map can't be dragged out of view. Does
   * nothing when nothing changes (unless `redraw`), so the wheel handler can
   * tell whether the map zoomed.
   */
  private set(scale: number, centre: Point, redraw = false): void {
    const { width, height } = this.size;
    // Hidden (the game screen isn't shown yet): wait for the ResizeObserver.
    if (width === 0 || height === 0) return;
    const fitScale = this.fitScale();
    const s = clamp(scale, fitScale, this.maxScale());
    const c = {
      x: clampCentre(centre.x, this.fit.x, this.fit.width, width / s),
      y: clampCentre(centre.y, this.fit.y, this.fit.height, height / s),
    };
    const v = this.view;
    if (!redraw && v && v.scale === s && v.centre.x === c.x && v.centre.y === c.y) return;
    this.view = { scale: s, centre: c };
    this.showingAll = s <= fitScale;
    this.fitButton.disabled = this.showingAll;
    const w = width / s;
    const h = height / s;
    this.svg.setAttribute("viewBox", `${(c.x - w / 2).toFixed(2)} ${(c.y - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  }

  /** Draws the view again after new bounds or a resize, which can leave it outside the limits. */
  private render(): void {
    const view = this.view ?? this.startView();
    this.set(view.scale, view.centre, true);
  }
}

/**
 * The middle of the view along one axis, kept so the view stays on the
 * dungeon (`start` and `length`). When the view is longer than the dungeon,
 * the dungeon is centred: the only case with empty space around it.
 */
function clampCentre(centre: number, start: number, length: number, viewLength: number): number {
  if (viewLength >= length) return start + length / 2;
  return clamp(centre, start + viewLength / 2, start + length - viewLength / 2);
}

function middleOf(box: ViewBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
