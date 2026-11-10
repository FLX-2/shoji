/** Words a question starts with. "Can you…", "Could you…" and the like ask for work, so they don't count. */
const ASKING = /^(what|what's|whats|why|how|which|who|whose|when|where|is|are|was|were|does|do|did|has|have)\b/i;
const REQUEST = /^(can|could|would|will) you\b|^please\b|^(how|what) about\b/i;

/**
 * Whether a message sent as changes reads as a question about the work instead, such as "what model is being used
 * right now". Shoji answers those without planning or building again. A request that ends in a question mark,
 * such as "can you make it blue?", is still a request.
 */
export function readsAsQuestion(text: string): boolean {
  const said = text.trim();
  // One sentence only: "Why is it red? Make it blue." asks for a change.
  if (!said || said.includes("\n") || said.length > 240 || /[.!?]\s+\S/.test(said)) return false;
  if (REQUEST.test(said)) return false;
  return ASKING.test(said) || /\?$/.test(said);
}
