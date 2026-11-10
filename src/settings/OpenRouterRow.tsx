import type { OpenRouter } from "../stack/openrouter";

/** What OpenRouter gives Shoji, in a sentence. */
export function openrouterNote(openrouter: OpenRouter): string {
  if (openrouter.error) return openrouter.error;
  switch (openrouter.status) {
    case "looking":
      return "Checking for OpenRouter…";
    case "connecting":
      return "Finish connecting in your browser. Shoji waits here.";
    case "disconnected":
      return "Hundreds of models from many providers on one account, billed to your OpenRouter credit.";
    case "connected": {
      const how = openrouter.fromShell ? "Using the key from your shell." : "Connected.";
      return openrouter.count === null
        ? how
        : `${how} ${openrouter.count} models that can use tools, at OpenRouter's prices. Pick them in Stack.`;
    }
  }
}

/** OpenRouter's row: connect once in the browser, and its models join Stack's lists. */
export function OpenRouterRow({ openrouter }: { openrouter: OpenRouter }) {
  return (
    <div className="srow">
      <div>
        <b>OpenRouter</b>
        <span className="d" role="status">
          {openrouterNote(openrouter)}
        </span>
      </div>
      {openrouter.status === "connected" ? (
        !openrouter.fromShell && (
          <button type="button" className="btn sm" onClick={openrouter.disconnect}>
            Disconnect
          </button>
        )
      ) : (
        <button
          type="button"
          className="btn sm"
          disabled={openrouter.status !== "disconnected"}
          onClick={openrouter.connect}
        >
          Connect OpenRouter
        </button>
      )}
    </div>
  );
}
