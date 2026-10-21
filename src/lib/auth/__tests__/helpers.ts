import { InMemoryUserStore, type UserStore } from "../user-store";

/** A fresh, isolated user store for a single test (no shared global state). */
export function makeUserStore(): UserStore {
  return new InMemoryUserStore();
}
