import type { Me } from "@a11-wild/shared";
import { createContext, useContext } from "react";

const SessionContext = createContext<Me | undefined>(undefined);

export const SessionProvider = SessionContext.Provider;

/** The signed-in person. Only pages inside the signed-in layout may call it. */
export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe needs a signed-in session");
  return me;
}
