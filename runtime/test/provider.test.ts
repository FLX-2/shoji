// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { KEY_REJECTED, KeyRejectedError, plainApiError } from "../src/provider";

/** An error as the SDK makes it from a response's status and JSON body. */
function api(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());
}

const said = (error: unknown) => plainApiError(error, "claude-sonnet-5-5").message;

describe("plainApiError", () => {
  it("says what to do instead of showing a status code and JSON", () => {
    expect(said(api(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"))).toBe(
      "Anthropic is limiting how fast your API key can send. Wait a minute, then try again.",
    );
    expect(said(api(529, "overloaded_error", "Overloaded"))).toBe(
      "Anthropic's API is busy right now. Try again in a few minutes.",
    );
    expect(said(api(500, "api_error", "Internal server error"))).toBe(
      "Anthropic's API had a problem on its side. Try again in a few minutes.",
    );
    expect(said(new Anthropic.APIConnectionError({ message: "Connection error." }))).toBe(
      "Shoji couldn't reach Anthropic. Check your internet connection, then try again.",
    );
  });

  it("names running out of credit and a model the key can't use", () => {
    const broke = api(
      400,
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    );
    expect(said(broke)).toBe(
      "Your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.",
    );
    expect(said(api(404, "not_found_error", "model: claude-sonnet-5-5"))).toBe(
      "Anthropic doesn't offer Sonnet 5.5 to your API key. Pick another model in Stack.",
    );
  });

  it("keeps the API's own words for any other refusal, without the JSON around them", () => {
    expect(said(api(400, "invalid_request_error", "prompt is too long: 210000 tokens > 200000 maximum"))).toBe(
      "Anthropic turned the request down: prompt is too long: 210000 tokens > 200000 maximum",
    );
  });

  it("still marks a rejected key, and leaves errors from elsewhere alone", () => {
    const rejected = plainApiError(api(401, "authentication_error", "invalid x-api-key"), "claude-haiku-5-5");
    expect(rejected).toBeInstanceOf(KeyRejectedError);
    expect(rejected.message).toBe(KEY_REJECTED);
    const other = new Error("disk full");
    expect(plainApiError(other, "claude-haiku-5-5")).toBe(other);
  });
});
