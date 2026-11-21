export const staticDataMode = process.env.NEXT_PUBLIC_STATIC_DATA === "1";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1").replace(/\/$/, "");
const staticDataBase = (process.env.NEXT_PUBLIC_STATIC_DATA_BASE_URL || "/data/api/v1").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const endpoint = path.replace(/^\/+/, "");
  if (staticDataMode) {
    return `${staticDataBase}/${endpoint.split("?", 1)[0]}.json`;
  }
  return `${apiBase}/${endpoint}`;
}
