import { useEffect } from "react";

import { isTauriDesktop, openExternalWindow } from "@/services/tauriBridge";

/**
 * Routes external new-window requests to native macOS windows.
 * This covers both anchor target="_blank" clicks and legacy window.open calls.
 */
export function ExternalLinkHandler() {
  useEffect(() => {
    if (!isTauriDesktop()) return;

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;

      const rawHref = anchor.href;
      if (!rawHref) return;

      let destination: URL;
      try {
        destination = new URL(rawHref, window.location.href);
      } catch {
        return;
      }

      if (destination.protocol !== "https:" && destination.protocol !== "http:") return;
      if (destination.origin === window.location.origin) return;

      event.preventDefault();
      event.stopPropagation();
      void openExternalWindow(destination.href);
    };

    document.addEventListener("click", handleClick, true);

    const originalOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (url == null) return originalOpen(url, target, features);
      let destination: URL;
      try {
        destination = new URL(String(url), window.location.href);
      } catch {
        return originalOpen(url, target, features);
      }

      if (
        (destination.protocol === "https:" || destination.protocol === "http:") &&
        destination.origin !== window.location.origin &&
        (!target || target === "_blank")
      ) {
        void openExternalWindow(destination.href);
        return null;
      }
      return originalOpen(url, target, features);
    }) as typeof window.open;

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.open = originalOpen;
    };
  }, []);

  return null;
}
