export const staticDataMode = process.env.NEXT_PUBLIC_STATIC_DATA === "1";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const endpoint = path.replace(/^\/+/, "");
  if (staticDataMode) {
    return `/data/api/v1/${endpoint.split("?", 1)[0]}.json`;
  }
  return `${apiBase}/${endpoint}`;
}
