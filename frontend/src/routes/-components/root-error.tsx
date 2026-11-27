import { type ErrorComponentProps, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /((?:[?&]|\b)(?:access_token|refresh_token|token|authorization|cookie|api[_-]?key)\s*[=:]\s*)[^&#\s)"']+/gi,
      "$1[REDACTED]",
    )
    .replace(/((?:authorization|cookie)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]");
}

function buildDiagnosticReport(error: unknown): string {
  const isError = error instanceof Error;
  const name = isError ? error.name : typeof error;
  const message = isError ? error.message : String(error ?? "Unknown error");
  const stack = isError && error.stack ? error.stack : "(stack trace unavailable)";
  const cause =
    isError && error.cause instanceof Error
      ? "\n" + error.cause.name + ": " + error.cause.message + "\n" + (error.cause.stack ?? "")
      : "";

  const isTauri =
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;

  const runtime = typeof window === "undefined" ? "server-render" : isTauri ? "tauri-webview" : "browser";
  const location =
    typeof window === "undefined"
      ? "(window unavailable)"
      : window.location.origin + window.location.pathname;
  const userAgent = typeof navigator === "undefined" ? "(unavailable)" : navigator.userAgent;

  return [
    "HUSEYNOVLAR TERMINAL — CLIENT ERROR DIAGNOSTIC",
    "time_utc: " + new Date().toISOString(),
    "runtime: " + runtime,
    "build_mode: " + import.meta.env.MODE,
    "location: " + location,
    "user_agent: " + userAgent,
    "error_name: " + name,
    "error_message: " + message,
    "stack:",
    stack,
    cause ? "cause:" + cause : "",
  ]
    .filter(Boolean)
    .map((line) => redactDiagnosticText(line))
    .join("\n");
}

export function RootError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const isTauri =
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;
  const diagnosticReport = isTauri ? buildDiagnosticReport(error) : "";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-6 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error occurred while loading this page. Try again or return to the terminal.
        </p>
        {import.meta.env.DEV && !isTauri ? (
          <p className="text-destructive text-sm">{message}</p>
        ) : null}
      </div>

      {isTauri ? (
        <section className="w-full max-w-4xl rounded-md border border-destructive/40 bg-card p-3 text-left">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-destructive">Tauri diagnostic report</h2>
            <span className="text-xs text-muted-foreground">Copy the complete report and send it for analysis</span>
          </div>
          <pre className="max-h-[55dvh] overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-left font-mono text-xs leading-relaxed select-text">
            {diagnosticReport}
          </pre>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button nativeButton={false} variant="outline" render={<Link to="/dashboard/default" replace />}>
          Go to terminal
        </Button>
      </div>
    </main>
  );
}
