/** The backgrounds drawn behind the main stage's glass, from the Shoji prototype. */
export type FieldId = "code" | "dots" | "none";

export const FIELD_NAMES: Record<FieldId, string> = { code: "Code current", dots: "Dot tide", none: "None" };

type Rgb = readonly [number, number, number];

export interface Frame {
  /** Simulated time in seconds. It runs faster while something is running. */
  t: number;
  /** Something is running, so the brightest parts take the accent. */
  running: boolean;
  /** The accent, as red, green and blue. */
  accent: Rgb;
  /** The glyphs' and dots' own colour: light on the darkroom, a soft warm grey on paper. */
  ink: Rgb;
  /** Glyphs may change from frame to frame. */
  live: boolean;
}

const GAIN = 1;
const GLYPHS = "{}()[]<>=+-*/;:._|&!?#01λ→".split("");

function rgba(c: Rgb, a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, Math.max(0, a)).toFixed(3)})`;
}

/** How strongly a point sits on one of three slow bands crossing the field, 0 to 1. */
function band(x: number, y: number, t: number) {
  const c1 = 0.46 + 0.17 * Math.sin(x * 6.9 + t * 0.7) + 0.07 * Math.sin(x * 17 - t * 0.5) - (x - 0.5) * 0.22;
  const d1 = (y - c1) / 0.15;
  const c2 = 0.84 + 0.08 * Math.sin(x * 5 - t * 0.4);
  const d2 = (y - c2) / 0.08;
  const c3 = 0.16 + 0.05 * Math.sin(x * 4 + t * 0.3);
  const d3 = (y - c3) / 0.07;
  return Math.max(Math.exp(-d1 * d1), 0.55 * Math.exp(-d2 * d2), 0.4 * Math.exp(-d3 * d3));
}

/** Which glyph sits in each cell of the code field; kept between frames so most stay put. */
export interface FieldState {
  glyphs?: number[];
}

export function drawField(id: FieldId, c: CanvasRenderingContext2D, w: number, h: number, f: Frame, st: FieldState) {
  c.clearRect(0, 0, w, h);
  if (id === "code") drawCode(c, w, h, f, st);
  else if (id === "dots") drawDots(c, w, h, f);
}

function drawCode(c: CanvasRenderingContext2D, w: number, h: number, f: Frame, st: FieldState) {
  const cw = 11;
  const ch = 15;
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  if (!st.glyphs || st.glyphs.length !== cols * rows) {
    st.glyphs = Array.from({ length: cols * rows }, () => (Math.random() * GLYPHS.length) | 0);
  }
  c.font = "500 10px 'DM Mono', ui-monospace, monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  const change = f.running ? 0.03 : 0.005;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const strength = band(i / cols, r / rows, f.t);
      const a = 0.6 * strength * GAIN;
      if (a < 0.02) continue;
      const k = r * cols + i;
      if (f.live && Math.random() < change) st.glyphs[k] = (Math.random() * GLYPHS.length) | 0;
      const hot = f.running && strength > 0.82;
      c.fillStyle = rgba(hot ? f.accent : f.ink, hot ? a * 1.5 : a);
      c.fillText(GLYPHS[st.glyphs[k]], i * cw + cw / 2, r * ch + ch / 2);
    }
  }
}

function drawDots(c: CanvasRenderingContext2D, w: number, h: number, f: Frame) {
  const rows = Math.max(14, Math.round(h / 24));
  const cols = Math.max(18, Math.round(w / 12));
  for (let r = 0; r < rows; r++) {
    const z = r / (rows - 1);
    const scale = 0.3 + 0.7 * z * z;
    for (let i = 0; i < cols; i++) {
      const x = (i / (cols - 1)) * 2 - 1;
      const swell =
        Math.sin(x * 2.6 + f.t * 0.9 + z * 3) * 0.5 +
        Math.sin(x * 5.1 - f.t * 0.6 + z * 7) * 0.25 +
        Math.sin(z * 6 + f.t * 0.5) * 0.25;
      const sx = w / 2 + x * w * 0.8 * (0.55 + 0.45 * scale);
      const sy = h * (0.1 + 0.86 * z) - swell * h * 0.11 * scale;
      const a = GAIN * (0.28 + 0.7 * z) * (0.45 + 0.55 * swell);
      const hot = f.running && swell > 0.55;
      c.fillStyle = rgba(hot ? f.accent : f.ink, hot ? Math.min(0.95, a * 1.8) : a);
      c.beginPath();
      c.arc(sx, sy, (0.9 + 2.9 * scale) * (hot ? 1.2 : 1), 0, Math.PI * 2);
      c.fill();
    }
  }
}
