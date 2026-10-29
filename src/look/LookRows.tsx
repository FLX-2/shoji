import type { CSSProperties } from "react";
import type { Prefs } from "../settings/prefs";
import { FIELD_NAMES, type FieldId } from "./fields";

interface RowProps {
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
}

export function BackgroundRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Background</b>
        <span className="d">Moves slowly behind the glass, and never asks for attention.</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Background">
        {(Object.keys(FIELD_NAMES) as FieldId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={prefs.field === id}
            onClick={() => onChange({ field: id })}
          >
            {FIELD_NAMES[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MotionRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Interface motion</b>
        <span className="d">Transitions when things open, close or change. Off also holds the background still.</span>
      </div>
      <button
        type="button"
        className="sw"
        role="switch"
        aria-checked={prefs.motion}
        aria-label="Interface motion"
        onClick={() => onChange({ motion: !prefs.motion })}
      />
    </div>
  );
}

export function FrostRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <label htmlFor="s-frost">
        <b>Main area frost</b>
        <span className="d">
          The bars and side panes are always solid. This only changes the glass over the center.
        </span>
      </label>
      <div className="range">
        <input
          id="s-frost"
          type="range"
          min={0}
          max={100}
          value={prefs.frost}
          disabled={prefs.opaque}
          onChange={(e) => onChange({ frost: Number(e.target.value) })}
        />
        <span className="val">{prefs.frost}</span>
      </div>
    </div>
  );
}

export function OpaqueRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Reduce transparency</b>
        <span className="d">Makes every surface solid and turns off the background and all blur.</span>
      </div>
      <button
        type="button"
        className="sw"
        role="switch"
        aria-checked={prefs.opaque}
        aria-label="Reduce transparency"
        onClick={() => onChange({ opaque: !prefs.opaque })}
      />
    </div>
  );
}

/** The frost setting as the CSS the main stage reads: how much blur, and how much of the matte shows. */
export function frostStyle(frost: number) {
  const f = frost / 100;
  return { "--bm": `${(1 + f * 14).toFixed(1)}px`, "--tm": (0.12 + f * 0.7).toFixed(3) } as CSSProperties;
}
