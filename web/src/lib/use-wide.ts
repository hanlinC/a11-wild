import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 768px)";
const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : undefined);

/** Whether the window has room for the sections side by side. A phone has not. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = media();
      query?.addEventListener("change", changed);
      return () => query?.removeEventListener("change", changed);
    },
    () => media()?.matches ?? true,
  );
}
