import type { Attention } from "@a11-wild/shared";
import { createContext, useContext } from "react";

/** What waits for the owner, as the frame last read it: the top bar and the start page show the same numbers. */
export interface AttentionState {
  value: Attention | undefined;
  /** A sentence, when the last read failed. */
  error: string | undefined;
}

const AttentionContext = createContext<AttentionState>({ value: undefined, error: undefined });

export const AttentionProvider = AttentionContext.Provider;
export const useAttention = (): AttentionState => useContext(AttentionContext);
