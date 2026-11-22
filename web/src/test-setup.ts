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
// jsdom does not open or close a dialog; the browser does, and it puts the focus on the first control inside.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute("open", "");
  this.querySelector("button")?.focus();
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
windowIs("wide");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  windowIs("wide");
});
