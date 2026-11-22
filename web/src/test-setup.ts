import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { windowIs } from "./test-helpers";

// jsdom has no layout engine; the components only need these to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
windowIs("wide");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  windowIs("wide");
});
