import { MODELS } from "../../runtime/src/models";
import type { ChatGPT } from "../stack/chatgpt";

/** What the person's ChatGPT plan gives Shoji, in a sentence. */
export function chatgptNote(chatgpt: ChatGPT): string {
  if (chatgpt.error) return chatgpt.error;
  switch (chatgpt.status) {
    case "looking":
      return "Checking your ChatGPT sign-in…";
    case "signing-in":
      return "Finish signing in in your browser. Shoji waits here.";
    case "signed-out":
      return "With ChatGPT Plus or Pro, OpenAI's models run on your plan, with no API key and no API bill.";
    case "signed-in": {
      const names = chatgpt.models.map((m) => MODELS[m].label);
      const listed = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
      const who = chatgpt.email ? `Signed in as ${chatgpt.email}.` : "Signed in.";
      return listed ? `${who} ${listed}, on your plan.` : `${who} Your plan offers no models Shoji can use yet.`;
    }
  }
}

/** ChatGPT's row: sign in once in the browser, and runs on its models use the plan from then on. */
export function ChatGPTRow({
  chatgpt,
  onManageUsage,
  setup = false,
}: {
  chatgpt: ChatGPT;
  onManageUsage: () => void;
  setup?: boolean;
}) {
  const signedIn = chatgpt.status === "signed-in";
  return (
    <>
      <div className="srow">
        <div>
          <b>ChatGPT</b>
          <span className="d" role="status">
            {chatgptNote(chatgpt)}
          </span>
        </div>
        {signedIn && setup ? (
          <span className="pill">
            <span className="dot ok" aria-hidden="true" />
            connected
          </span>
        ) : signedIn ? (
          <span className="acts">
            <button type="button" className="btn sm" onClick={onManageUsage}>
              Manage usage
            </button>
            <button type="button" className="btn sm" onClick={chatgpt.signOut}>
              Sign out
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn sm"
            disabled={chatgpt.status !== "signed-out"}
            onClick={chatgpt.signIn}
          >
            Continue with ChatGPT
          </button>
        )}
      </div>
      {signedIn && chatgpt.welcome && (
        <div className="srow">
          <div>
            <b>You're using your ChatGPT plan.</b>
            <span className="d">
              Steps on ChatGPT's models count toward your plan's limits, not an API bill. If a limit is reached, the
              thread stops and says so. Shoji never switches to paid use by itself.
            </span>
          </div>
          <button type="button" className="btn sm" onClick={chatgpt.gotIt}>
            Got it
          </button>
        </div>
      )}
    </>
  );
}
