import { labelOf } from "../../runtime/src/models";
import type { LocalServer } from "../stack/local";

/** What LM Studio or llama.cpp's server has for Shoji, in a sentence. */
export function localNote(local: LocalServer): string {
  switch (local.status) {
    case "looking":
      return "Looking for LM Studio or llama.cpp on this computer…";
    case "ready": {
      const names = local.models.map((m) => labelOf(m));
      const listed = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
      return `${listed} on ${local.name}. Free, and your code stays on this computer. Load models with a context of 32K or more.`;
    }
    case "off":
      if (local.missed)
        return "Neither LM Studio nor llama.cpp's server answered. Start its server with a model loaded, then look again.";
      return "Models on this computer through LM Studio or llama.cpp's server. Start its server with a model loaded, then look again.";
  }
}

/** The local server's row: what it has, and a way to look again after starting it or loading a model. */
export function LocalRow({ local, setup = false }: { local: LocalServer; setup?: boolean }) {
  return (
    <div className="srow">
      <div>
        <b>LM Studio and llama.cpp</b>
        <span className="d">{localNote(local)}</span>
      </div>
      {setup && local.status === "ready" ? (
        <span className="pill">
          <span className="dot ok" aria-hidden="true" />
          connected
        </span>
      ) : (
        <button
          type="button"
          className="btn sm"
          aria-label="Look for LM Studio or llama.cpp again"
          disabled={local.status === "looking"}
          onClick={local.look}
        >
          Look again
        </button>
      )}
    </div>
  );
}
