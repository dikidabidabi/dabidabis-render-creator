const KEY = "hf_token";

export function getHfToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function setHfToken(value: string) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(KEY, value);
  else window.localStorage.removeItem(KEY);
}
