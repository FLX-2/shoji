import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MODELS, type ModelId } from "../../runtime/src/models";

/** Past this many models the list gets a box to narrow it by name. */
const FILTER_FROM = 9;

/** A model's family, such as Opus: the first word of its name. */
export const familyOf = (id: ModelId) => MODELS[id].label.split(" ")[0];

/**
 * Every model Shoji knows, in families: the family with the dearest model first, and in each family the newest
 * first. A list that grows with each model the catalog adds stays easy to scan.
 */
export function modelGroups(ids: ModelId[] = Object.keys(MODELS)): { family: string; ids: ModelId[] }[] {
  const families = new Map<string, ModelId[]>();
  for (const id of ids) families.set(familyOf(id), [...(families.get(familyOf(id)) ?? []), id]);
  const newest = (a: ModelId, b: ModelId) => MODELS[b].label.localeCompare(MODELS[a].label, "en", { numeric: true });
  const dearest = (members: ModelId[]) => Math.max(...members.map((id) => MODELS[id].output));
  return [...families]
    .map(([family, members]) => ({ family, ids: members.sort(newest) }))
    .sort((a, b) => dearest(b.ids) - dearest(a.ids) || a.family.localeCompare(b.family));
}

/** A model's prices, as "$4 in, $20 out": dollars per million tokens. */
export const priceLine = (id: ModelId) => `${dollars(MODELS[id].input)} in, ${dollars(MODELS[id].output)} out`;

const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** One role's model: the pick shows on a lifted button, and the list of every model opens under it. */
export function ModelPick({
  label,
  value,
  onPick,
  fresh = [],
  openAt = 0,
}: {
  /** What the choice is, such as "Plan model". */
  label: string;
  value: ModelId;
  onPick: (model: ModelId) => void;
  /** Models the list brought that the person hasn't tried or set aside, marked New. */
  fresh?: ModelId[];
  /** Opens the list when it changes to a new time, as when Watching suggests another model for this role. */
  openAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<ModelId>(value);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  const all = Object.keys(MODELS);
  const filtering = all.length >= FILTER_FROM;
  const wanted = filter.trim().toLowerCase();
  const groups = modelGroups(all.filter((m) => !wanted || MODELS[m].label.toLowerCase().includes(wanted)));
  const shown = groups.flatMap((g) => g.ids);
  // Family names only help once a family has more than one model.
  const headed = groups.some((g) => g.ids.length > 1);
  const current = shown.includes(active) ? active : shown[0];

  const close = (refocus: boolean) => {
    setOpen(false);
    setFilter("");
    if (refocus) button.current?.focus();
  };
  const pick = (model: ModelId) => {
    onPick(model);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    (field.current ?? list.current)?.focus();
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (!openAt) return;
    setActive(value);
    setOpen(true);
    button.current?.scrollIntoView?.({ block: "center" });
    // Only a new request opens it, never a new pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-model="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, current]);

  const onKey = (e: KeyboardEvent) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move && shown.length) {
      e.preventDefault();
      setActive(shown[(shown.indexOf(current) + move + shown.length) % shown.length]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? shown[0] : shown[shown.length - 1]);
    } else if ((e.key === "Enter" || (e.key === " " && !filtering)) && current) {
      e.preventDefault();
      pick(current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const option = (model: ModelId) => (
    <li
      key={model}
      id={`${id}-${model}`}
      data-model={model}
      role="option"
      aria-selected={model === value}
      data-active={model === current || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(model)}
      onMouseMove={() => model !== current && setActive(model)}
    >
      <b>
        {MODELS[model].label}
        {fresh.includes(model) && <i className="new">New</i>}
      </b>
      <span>{priceLine(model)}</span>
      <svg className="tick" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
      </svg>
    </li>
  );

  return (
    <div className="modelpick" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="mbtn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => {
          if (open) close(false);
          else {
            setActive(value);
            setOpen(true);
          }
        }}
      >
        <span className="tile">{MODELS[value]?.label ?? value}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="mlist">
          {filtering && (
            <input
              ref={field}
              type="text"
              aria-label={`Find a model for ${label.toLowerCase().replace(/ model$/, "")}`}
              placeholder="Find a model"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={onKey}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={current ? `${id}-${current}` : undefined}
            />
          )}
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={filtering ? -1 : 0}
            aria-activedescendant={!filtering && current ? `${id}-${current}` : undefined}
            onKeyDown={filtering ? undefined : onKey}
          >
            {headed
              ? groups.map((g) => (
                  <li key={g.family} role="presentation">
                    <span className="k" id={`${id}-${g.family}`}>
                      {g.family}
                    </span>
                    <ul role="group" aria-labelledby={`${id}-${g.family}`}>
                      {g.ids.map(option)}
                    </ul>
                  </li>
                ))
              : shown.map(option)}
            {shown.length === 0 && (
              <li role="presentation" className="none">
                No model is called that.
              </li>
            )}
          </ul>
          <p className="mnote">Dollars per million tokens</p>
        </div>
      )}
    </div>
  );
}
