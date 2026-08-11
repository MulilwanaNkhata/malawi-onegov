import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearTokens, getAccessToken, setTokens } from "../api/client";

export interface CurrentUser {
  id: string;
  fullName: string;
  phone: string;
  role: "CITIZEN" | "REGISTRAR_OFFICER" | "REGISTRAR_SUPERVISOR" | "SYSTEM_ADMIN";
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  loginPassword: (phone: string, password: string) => Promise<{ mfaTicket: string }>;
  loginMfa: (mfaTicket: string, code: string) => Promise<void>;
  register: (input: {
    fullName: string;
    phone: string;
    email?: string;
    nationalId?: string;
    password: string;
  }) => Promise<{ mfaEnrollment: { secret: string; qrCodeDataUrl: string } }>;
  logout: () => void;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadCurrentUser() {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/users/me");
      setUser(data);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginPassword(phone: string, password: string) {
    const { data } = await api.post("/auth/login", { phone, password });
    return { mfaTicket: data.mfaTicket };
  }

  async function loginMfa(mfaTicket: string, code: string) {
    const { data } = await api.post("/auth/mfa/verify", { mfaTicket, code });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }

  async function register(input: {
    fullName: string;
    phone: string;
    email?: string;
    nationalId?: string;
    password: string;
  }) {
    const { data } = await api.post("/auth/register", input);
    return { mfaEnrollment: data.mfaEnrollment };
  }

  function logout() {
    clearTokens();
    setUser(null);
  }

  const isStaff = user ? user.role !== "CITIZEN" : false;

  return (
    <AuthContext.Provider value={{ user, loading, loginPassword, loginMfa, register, logout, isStaff }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
