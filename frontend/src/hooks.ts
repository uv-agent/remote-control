import { useEffect, useState } from "react";

export function useLocalString(key: string, fallback: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) || fallback);
  const save = (next: string) => {
    setValue(next);
    localStorage.setItem(key, next);
  };
  return [value, save] as const;
}

export function useLocalNumber(key: string, fallback: number) {
  const [value, setValue] = useState(() => Number(localStorage.getItem(key) || String(fallback)));
  const save = (next: number) => {
    setValue(next);
    localStorage.setItem(key, String(next));
  };
  return [value, save] as const;
}

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    listener();
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}
