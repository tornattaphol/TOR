import { getPrisma } from "./prisma";
import { PrismaDrawStore } from "./prisma-store";
import type { DrawStore } from "./store";

let current: DrawStore | null = null;

/** The process-wide store. PostgreSQL by default; tests inject an in-memory store with setStore(). */
export function getStore(): DrawStore {
  if (!current) current = new PrismaDrawStore(getPrisma());
  return current;
}

export function setStore(store: DrawStore | null): void {
  current = store;
}

export type { DrawStore } from "./store";
