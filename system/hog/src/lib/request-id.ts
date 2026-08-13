import { AsyncLocalStorage } from "node:async_hooks";

export const requestIdStore = new AsyncLocalStorage<string>();

export function getRequestId(): string | undefined {
  return requestIdStore.getStore();
}
