import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "mortimer:";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw) as T;
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback) && value && typeof value === "object") {
      return { ...fallback, ...value };
    }
    return value;
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
