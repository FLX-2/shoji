import type { CSSProperties } from "react";
import { TEXT_SIZES, type Prefs } from "../settings/prefs";
import { ACCENTS, type AccentId } from "./accent";
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

export function AccentRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Accent</b>
        <span className="d">Used for one thing only: something is running or spending.</span>
      </div>
      <div className="swatches" role="radiogroup" aria-label="Accent">
        {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            className="swc"
            aria-checked={prefs.accent === id}
            onClick={() => onChange({ accent: id })}
          >
            <i style={{ background: `rgb(${ACCENTS[id].rgb.join(",")})` }} aria-hidden="true" />
            {ACCENTS[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DensityRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Density</b>
        <span className="d">Compact fits more on screen, with smaller text and tighter rows.</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Density">
        {(["comfortable", "compact"] as const).map((density) => (
          <button
            key={density}
            type="button"
            role="radio"
            aria-checked={prefs.density === density}
            onClick={() => onChange({ density })}
          >
            {density === "comfortable" ? "Comfortable" : "Compact"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextSizeRow({ prefs, onChange }: RowProps) {
  return (
    <div className="srow">
      <div>
        <b>Text size</b>
        <span className="d">Draws all of Shoji larger or smaller. Ctrl or ⌘ with + and − does the same, and 0 sets it back.</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={prefs.textSize === size}
            onClick={() => onChange({ textSize: size })}
          >
            {Math.round(size * 100)}%
          </button>
        ))}
      </div>
    </div>
  );
}

/** An on or off setting. */
export function SwitchRow({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="srow">
      <div>
        <b>{label}</b>
        <span className="d">{description}</span>
      </div>
      <button type="button" className="sw" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} />
    </div>
  );
}

/** The frost setting as the CSS the main stage reads: how much blur, and how much of the matte shows. */
export function lookStyle(prefs: Prefs) {
  const f = prefs.frost / 100;
  const rgb = ACCENTS[prefs.accent].rgb.join(",");
  return {
    "--bm": `${(1 + f * 14).toFixed(1)}px`,
    "--tm": (0.12 + f * 0.7).toFixed(3),
    "--safe": `rgb(${rgb})`,
    "--safe-rgb": rgb,
  } as CSSProperties;
}
