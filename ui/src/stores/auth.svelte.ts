import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [adminClient()],
});

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

class AuthStore {
  user = $state<SessionUser | null>(null);
  loading = $state(true);

  async check() {
    this.loading = true;
    try {
      const { data } = await authClient.getSession();
      this.user = data
        ? {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: (data.user as { role?: string }).role ?? "user",
          }
        : null;
    } catch {
      this.user = null;
    } finally {
      this.loading = false;
    }
  }

  async signIn(email: string, password: string) {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? "Sign in failed");
    this.user = {
      id: data!.user.id,
      name: data!.user.name,
      email: data!.user.email,
      role: (data!.user as { role?: string }).role ?? "user",
    };
  }

  async signUp(name: string, email: string, password: string) {
    const { data, error } = await authClient.signUp.email({ name, email, password });
    if (error) throw new Error(error.message ?? "Sign up failed");
    this.user = data?.user
      ? {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: (data.user as { role?: string }).role ?? "user",
        }
      : null;
  }

  async signOut() {
    await authClient.signOut();
    this.user = null;
  }

  get isAdmin() {
    return this.user?.role === "admin";
  }
}

export const authStore = new AuthStore();
