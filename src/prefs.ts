import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "mortimer:";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);

    if (Array.isArray(fallback)) return (Array.isArray(value) ? value : fallback) as T;
    if (fallback === null) {
      return (value === null || (typeof value === "object" && value !== null)) ? value as T : fallback;
    }
    switch (typeof fallback) {
      case "boolean": return (typeof value === "boolean" ? value : fallback) as T;
      case "number": return (typeof value === "number" && Number.isFinite(value) ? value : fallback) as T;
      case "string": return (typeof value === "string" ? value : fallback) as T;
    }
    if (typeof fallback === "object") {
      if (value && typeof value === "object" && !Array.isArray(value)) return { ...fallback, ...value } as T;
      return fallback;
    }
    return value as T;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {}
}

export function usePref<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  useEffect(() => { writePref(key, value); }, [key, value]);
  return [value, setValue];
}
