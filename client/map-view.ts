// Zooming and moving the map on its own, without zooming the page (design.md, Mobile).
//
// The map is an SVG picture, and its `viewBox` attribute says which part of
// the picture fills the <svg> element (see hex-map.ts). Zooming in is
// showing a smaller part of the picture in the same element, and moving is
// shifting that part, so both only change the viewBox: nothing is redrawn.
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

/** A part of the picture, in SVG user units, as in the `viewBox` attribute. */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zooming in stops when this much of the picture is still in view across: about five hex columns. */
const MIN_WIDTH = 230;
/** A touch or mouse press that moves further than this, in screen pixels, is a drag, not a tap. */
const DRAG_PIXELS = 8;
/** How much one notch of the mouse wheel zooms (100 pixels of `deltaY` is a typical notch). */
const WHEEL_ZOOM_PER_PIXEL = 0.002;

interface Point {
  x: number;
  y: number;
}

export class MapView {
  private readonly svg: SVGSVGElement;
  private readonly fitButton: HTMLButtonElement;
  /** The whole dungeon: the most that can be in view. */
  private fit: ViewBox = { x: 0, y: 0, width: 1, height: 1 };
  /** The part in view now. Always inside `fit`. */
  private view: ViewBox = this.fit;

  /** Where each pointer that is down was last seen, in screen pixels. */
  private readonly pointers = new Map<number, Point>();
  /** Where the first pointer of this press went down, to measure the drag threshold against. */
  private pressStart: Point | undefined;
  /** Whether the current (or last) press moved or pinched the map, so it isn't a tap. */
  private dragged = false;

  constructor(svg: SVGSVGElement, fitButton: HTMLButtonElement) {
    this.svg = svg;
    this.fitButton = fitButton;
    svg.addEventListener("pointerdown", (event) => this.pointerDown(event));
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
  }

  /**
   * Whether the last press was a drag or a pinch. The browser still fires a
   * `click` after one, so the map's click handler asks this to ignore it.
   */
  get wasDrag(): boolean {
    return this.dragged;
  }

  /**
   * Sets the box around the whole dungeon. `keepView` keeps the current
   * zoom and position, for a new snapshot of the same game (after a
   * reconnect, say); otherwise the whole dungeon is shown.
   */
  setBounds(fit: ViewBox, keepView: boolean): void {
    this.fit = fit;
    this.apply(keepView ? this.view : fit);
  }

  /** Shows the whole dungeon again (the "Fit" button). */
  showAll(): void {
    this.apply(this.fit);
  }

  private pointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // The first finger (or the mouse) starts a new press. Forgetting the old
    // pointers here means one whose "up" never arrived can't linger.
    if (event.isPrimary) this.pointers.clear();
    if (this.pointers.size === 0) {
      this.pressStart = { x: event.clientX, y: event.clientY };
      this.dragged = false;
    } else {
      // A second finger: this is a pinch, so the press is no tap.
      this.dragged = true;
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
    this.pointers.delete(event.pointerId);
    // `dragged` stays set until the next press, for the click that follows.
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
    const minWidth = Math.min(MIN_WIDTH, this.fit.width);
    const width = Math.min(Math.max(this.view.width / factor, minWidth), this.fit.width);
    const scale = width / this.view.width;
    if (scale === 1) return;
    const anchor = this.toPicture(screen);
    this.apply({
      x: anchor.x - (anchor.x - this.view.x) * scale,
      y: anchor.y - (anchor.y - this.view.y) * scale,
      width,
      height: this.view.height * scale,
    });
  }

  /** Moves the picture along with a pointer that went from `from` to `to` on screen. */
  private moveBy(from: Point, to: Point): void {
    const a = this.toPicture(from);
    const b = this.toPicture(to);
    this.apply({ ...this.view, x: this.view.x + a.x - b.x, y: this.view.y + a.y - b.y });
  }

  /**
   * A screen point in picture units. The SVG scales the view to fit the
   * element and centres it (preserveAspectRatio "xMidYMid meet", the
   * default), so this undoes that scaling and centring.
   */
  private toPicture(screen: Point): Point {
    const rect = this.svg.getBoundingClientRect();
    const scale = Math.min(rect.width / this.view.width, rect.height / this.view.height) || 1;
    const left = rect.left + (rect.width - this.view.width * scale) / 2;
    const top = rect.top + (rect.height - this.view.height * scale) / 2;
    return { x: this.view.x + (screen.x - left) / scale, y: this.view.y + (screen.y - top) / scale };
  }

  /** Shows `box`, kept inside the whole dungeon so the map can't be dragged out of view. */
  private apply(box: ViewBox): void {
    const width = Math.min(box.width, this.fit.width);
    const height = Math.min(box.height, this.fit.height);
    const view = {
      x: clamp(box.x, this.fit.x, this.fit.x + this.fit.width - width),
      y: clamp(box.y, this.fit.y, this.fit.y + this.fit.height - height),
      width,
      height,
    };
    const v = this.view;
    if (view.x === v.x && view.y === v.y && view.width === v.width && view.height === v.height) return;
    this.view = view;
    this.svg.setAttribute("viewBox", `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.width.toFixed(2)} ${view.height.toFixed(2)}`);
    this.fitButton.disabled = width >= this.fit.width && height >= this.fit.height;
  }
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
