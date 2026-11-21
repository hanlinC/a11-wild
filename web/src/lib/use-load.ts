import { useCallback, useEffect, useState } from "react";
import { describeError } from "@/lib/api";

/** Loads one thing for a page: the value, a sentence when it failed, and a way to load it again. */
export function useLoad<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setValue(await load());
      setError(undefined);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { value, error, reload, setValue };
}
