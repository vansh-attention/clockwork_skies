/**
 * How long the GPU spends drawing a frame, where the browser can tell us (EXT_disjoint_timer_query_webgl2: desktop
 * Chrome and Edge). A frame's time arrives a few frames late, and never blocks. Where the extension is missing,
 * `latest` stays null and callers fall back to the frame rate.
 *
 * The frame rate alone hides the load behind vertical sync: a frame that takes 9 ms and one that takes 13 ms both
 * show as 72 frames a second on a 144 Hz screen. This reads the real cost, so the resolution can follow it.
 */
type TimerExtension = { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number };

/** Queries still waiting for their result are dropped beyond this many (a stalled driver must not grow the list). */
const MAX_PENDING = 8;

export class GpuTimer {
  /** The most recent finished frame, in milliseconds; null until one arrives, and always null when unsupported. */
  latest: number | null = null;
  private readonly extension: TimerExtension | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];

  constructor(private readonly gl: WebGL2RenderingContext | null | undefined) {
    let extension: TimerExtension | null = null;
    try {
      extension = (gl?.getExtension?.("EXT_disjoint_timer_query_webgl2") as TimerExtension | null) ?? null;
    } catch {
      extension = null;
    }
    this.extension = extension;
  }

  get supported(): boolean { return this.extension !== null; }

  /** Call before the frame's first draw. */
  begin(): void {
    const { gl, extension } = this;
    if (!gl || !extension || this.active) return;
    this.collect();
    if (this.pending.length >= MAX_PENDING) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  /** Call after the frame's last draw. */
  end(): void {
    const { gl, extension } = this;
    if (!gl || !extension || !this.active) return;
    gl.endQuery(extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Read every finished query, oldest first; a result taken across a GPU hiccup (disjoint) is thrown away. */
  private collect(): void {
    const { gl, extension } = this;
    if (!gl || !extension) return;
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const query = this.pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) {
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) this.latest = nanoseconds / 1e6;
      }
      gl.deleteQuery(query);
      this.pending.shift();
    }
  }

  dispose(): void {
    const { gl, extension } = this;
    if (!gl) return;
    if (this.active && extension) {
      try { gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* the context may already be gone */ }
      gl.deleteQuery(this.active);
    }
    for (const query of this.pending) gl.deleteQuery(query);
    this.active = null;
    this.pending = [];
  }
}
