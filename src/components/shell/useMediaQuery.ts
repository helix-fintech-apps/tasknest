import { useSyncExternalStore } from "react";

/** Live `matchMedia` match; false where matchMedia is missing (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== "function") return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}

/** True from the Tailwind `md` breakpoint (768 px) up. */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");
