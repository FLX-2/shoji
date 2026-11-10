import { MODELS } from "../../runtime/src/models";
import type { Ollama } from "../stack/ollama";

/** What Ollama has for Shoji, in a sentence. */
export function ollamaNote(ollama: Ollama): string {
  switch (ollama.status) {
    case "looking":
      return "Looking for Ollama on this computer…";
    case "ready": {
      const names = ollama.models.map((m) => MODELS[m].label);
      const listed = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
      return `${listed}. Free, and your code stays on this computer.`;
    }
    case "none":
      return "Ollama is running, but none of its models can use tools, which every step needs. Pull one that can, then look again.";
    case "off":
      return "Models on this computer, for free. Install Ollama from ollama.com and pull a model that can use tools, then look again.";
  }
}

/** Ollama's row: what it has, and a way to look again after pulling a model or opening Ollama. */
export function OllamaRow({ ollama, setup = false }: { ollama: Ollama; setup?: boolean }) {
  return (
    <div className="srow">
      <div>
        <b>Ollama</b>
        <span className="d">{ollamaNote(ollama)}</span>
      </div>
      {setup && ollama.status === "ready" ? (
        <span className="pill">
          <span className="dot ok" aria-hidden="true" />
          connected
        </span>
      ) : (
        <button type="button" className="btn sm" disabled={ollama.status === "looking"} onClick={ollama.look}>
          Look again
        </button>
      )}
    </div>
  );
}
