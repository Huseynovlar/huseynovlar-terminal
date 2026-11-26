import { useEffect, useState } from "react";

import { apiRequestRaw } from "@/framework/api-client";

/** Resolves private `/api/v1/files/{id}` URLs into blob URLs using the authenticated client. */
export function useAuthImage(url: string | undefined | null): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setBlobUrl(undefined);
      return;
    }
    if (!url.startsWith("/api/v1/files/")) {
      setBlobUrl(url);
      return;
    }
    let cancelled = false;
    let created: string | undefined;
    apiRequestRaw(url.replace(/^\/api\/v1/, ""), { method: "GET" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(undefined);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return blobUrl;
}
