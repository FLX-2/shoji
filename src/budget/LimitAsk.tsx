import { useEffect, useRef } from "react";
import { formatCost } from "../thread/fold";

export interface Ask {
  /** What's been spent today. */
  spent: number;
  /** The most the run about to start may spend. */
  cap: number;
  /** What's about to start, as the sentence names it: "This thread" or "This trial". */
  what: string;
  go: () => void;
}

/** Asks before a run could take the day past its limit. */
export function LimitAsk({ ask, limit, onClose }: { ask: Ask; limit: number; onClose: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="scrim" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="ask" role="alertdialog" aria-labelledby="ask-h" aria-describedby="ask-d">
        <h2 id="ask-h">Past today's limit?</h2>
        <p id="ask-d">
          Today has cost {formatCost(ask.spent)} of your {formatCost(limit)} daily limit. {ask.what} may spend up to{" "}
          {formatCost(ask.cap)}, which could take today past it.
        </p>
        <div className="acts">
          <button type="button" className="btn" ref={cancel} onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="btn solid"
            onClick={() => {
              onClose();
              ask.go();
            }}
          >
            Start anyway
          </button>
        </div>
      </div>
    </div>
  );
}
