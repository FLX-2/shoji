// jsdom has no canvas or ResizeObserver. The background draws nothing in tests rather than logging that it
// can't. Runtime tests run in node, which has neither window nor canvas.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Tests never reach the network: a test that needs fetch stubs it.
if (typeof window !== "undefined") {
  globalThis.fetch = (() => Promise.reject(new TypeError("Tests have no network."))) as typeof fetch;
}
