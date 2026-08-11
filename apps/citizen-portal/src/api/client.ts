import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: `${BASE_URL}/api` });

export function getAccessToken(): string | null {
  return localStorage.getItem("onegov.accessToken");
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("onegov.refreshToken");
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem("onegov.accessToken", accessToken);
  localStorage.setItem("onegov.refreshToken", refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem("onegov.accessToken");
  localStorage.removeItem("onegov.refreshToken");
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken });
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && getRefreshToken()) {
      original._retry = true;
      if (!refreshInFlight) refreshInFlight = refreshAccessToken().finally(() => (refreshInFlight = null));
      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api.request(original);
      }
    }
    return Promise.reject(error);
  }
);
