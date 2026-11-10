import { createContext, useContext } from "react";
import type { ModelId } from "../../runtime/src/models";

/** Whether the person can run a model now: its provider is connected. Lists offer only these, so a model that
 *  needs a key nobody saved doesn't sit among the choices. Everything is reachable unless the app says otherwise. */
export const ReachContext = createContext<(model: ModelId) => boolean>(() => true);

export const useReaches = () => useContext(ReachContext);
