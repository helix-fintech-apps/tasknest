import { useHealth } from "./health";

/** Feature flags the server can switch on (plan section 9). Missing flags are off. */
export type FlagName =
  "chat" | "availability" | "dispute_evidence" | "help_articles" | (string & Record<never, never>);

export function useFlag(name: FlagName): boolean {
  return useHealth().features?.[name] === true;
}

export function useFlags(): Record<string, boolean> {
  return useHealth().features ?? {};
}
