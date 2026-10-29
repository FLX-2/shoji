// Compares Receipts' "saved against one model" estimate with what the routing spike measured.
// It reads recorded token counts only and calls no model. Run with `pnpm estimate-check`.
import { checkEstimate, formatCheck, type Spike } from "../src/receipts/estimateCheck";
import spike from "../src/receipts/fixtures/spike.json";

console.log(formatCheck(checkEstimate(spike as Spike)));
