import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Sparkles, Trash2 } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/ai/")({
  component: GeminiAiCopilotPage,
});

export interface AiBriefingItem {
  id: string;
  kind: string;
  title: string;
  content_md: string;
  model: string;
  created_at: string;
}

const QUICK_MODES = [
  { kind: "morning_briefing", prompt: "Generate an institutional morning briefing summarizing my current portfolio equity, open risk exposure, key macro catalysts today, and top headlines." },
  { kind: "risk_audit", prompt: "Perform a strict institutional risk audit on my open positions, floating PnL, symbol concentration, and drawdown limits. Highlight immediate red flags." },
  { kind: "asset_deep_dive", prompt: "Provide a multi-asset institutional deep-dive on XAUUSD, USTEC, and SPX based on the latest breaking news and macro regime." },
  { kind: "post_mortem", prompt: "Review recent trading performance and outline concrete execution discipline improvements and risk rules for the next session." },
] as const;

function GeminiAiCopilotPage() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("copilot");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [reply, setReply] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [briefings, setBriefings] = useState<AiBriefingItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AiBriefingItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBriefings = useCallback(async () => {
    setLoadingList(true);
    try {
      const rows = await apiRequest<AiBriefingItem[]>("/intelligence/ai/briefings");
      setBriefings(Array.isArray(rows) ? rows : []);
    } catch {
      setBriefings([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadBriefings();
  }, [loadBriefings]);

  async function runAnalysis(customPrompt?: string, customKind?: string) {
    const finalPrompt = (customPrompt ?? prompt).trim();
    if (finalPrompt.length < 3) return;
    setAnalyzing(true);
    try {
      const res = await apiRequest<{ reply?: string; content_md?: string; briefing_id?: string }>(
        "/intelligence/ai/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            prompt: finalPrompt,
            kind: customKind ?? kind,
            model,
          }),
        },
      );
      setReply(res.reply ?? res.content_md ?? "");
      notify.success("Gemini AI", model);
      await loadBriefings();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void runAnalysis();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/intelligence/ai/briefings/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.title);
      setDeleteTarget(null);
      await loadBriefings();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  const modeLabels = [t.ai.modeBriefing, t.ai.modeRisk, t.ai.modeDeepDive, t.ai.modePostMortem];

  return (
    <TerminalPageShell title={t.ai.title} subtitle={t.ai.subtitle} badge={model}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Sparkles className="size-4 text-primary" />
                  {t.ai.title}
                </CardTitle>
                <select
                  aria-label={t.ai.modelLabel}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MODES.map((m, idx) => (
                  <Button
                    key={m.kind}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={analyzing}
                    onClick={() => {
                      setKind(m.kind);
                      setPrompt(m.prompt);
                      void runAnalysis(m.prompt, m.kind);
                    }}
                  >
                    {modeLabels[idx]}
                  </Button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-2.5">
                <Textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t.ai.promptPlaceholder}
                  className="text-xs"
                />
                <AsyncButton
                  type="submit"
                  loading={analyzing}
                  loadingText={t.ai.analyzing}
                  disabled={prompt.trim().length < 3}
                >
                  <Sparkles className="mr-1.5 size-4" />
                  {t.ai.runAnalyze}
                </AsyncButton>
              </form>

              {reply ? (
                <div className="rounded-lg border border-primary/30 bg-muted/30 p-3 text-xs whitespace-pre-wrap leading-relaxed">
                  {reply}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t.ai.savedBriefings} ({briefings.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs">
            {loadingList ? (
              <TableSkeleton rows={5} cols={1} />
            ) : briefings.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">{t.common.noData}</p>
            ) : (
              briefings.map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-2 rounded-md border border-border/60 p-2.5">
                  <div className="min-w-0">
                    <Link
                      to="/dashboard/ai/$briefingId"
                      params={{ briefingId: b.id }}
                      className="line-clamp-2 font-medium hover:text-primary hover:underline"
                    >
                      {b.title}
                    </Link>
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{b.kind}</Badge>
                      <span>{new Date(b.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link to="/dashboard/ai/$briefingId" params={{ briefingId: b.id }} className="inline-flex h-7 items-center rounded border border-input px-1.5 hover:bg-accent">
                      <Eye className="size-3.5" />
                    </Link>
                    <Button size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" onClick={() => setDeleteTarget(b)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.ai.confirmDeleteTitle}
        description={t.ai.confirmDeleteDesc}
        loading={deleting}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
