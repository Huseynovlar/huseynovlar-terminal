import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { RobotItem } from "@/routes/(main)/dashboard/robots/index";

export const Route = createFileRoute("/(main)/dashboard/robots/$robotId/edit")({
  component: RobotEditPage,
});

function RobotEditPage() {
  const { robotId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [programName, setProgramName] = useState("");
  const [version, setVersion] = useState("");
  const [strategyNotes, setStrategyNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isBridge, setIsBridge] = useState(false);
  const [paramsJson, setParamsJson] = useState<Record<string, unknown>>({});

  useEffect(() => {
    apiRequest<RobotItem>(`/robots/${encodeURIComponent(robotId)}`)
      .then((r) => {
        setName(r.name);
        setSymbol(r.symbol || "");
        setProgramName(r.program_name || "");
        setVersion(r.version || "");
        setStrategyNotes(r.strategy_notes || "");
        setIsActive(r.is_active);
        const pj = (r.params_json && typeof r.params_json === "object" ? r.params_json : {}) as Record<string, unknown>;
        setParamsJson(pj);
        setIsBridge(Boolean(pj.is_bridge));
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [robotId, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/robots/${encodeURIComponent(robotId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          program_name: programName.trim(),
          version: version.trim(),
          strategy_notes: strategyNotes.trim(),
          is_active: isActive,
          params_json: { ...paramsJson, is_bridge: isBridge },
        }),
      });
      notify.success(t.common.savedSuccess, name);
      void navigate({ to: "/dashboard/robots" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.robots.editTitle}
      actions={
        <Link
          to="/dashboard/robots/$robotId"
          params={{ robotId }}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Link>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.robots.editTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="re-name">Name</Label>
              <Input id="re-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="re-sym">Symbol</Label>
              <Input id="re-sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="re-prog">{t.robots.programName}</Label>
              <Input id="re-prog" value={programName} onChange={(e) => setProgramName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="re-ver">{t.robots.version}</Label>
              <Input id="re-ver" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="re-notes">{t.robots.strategyNotes}</Label>
              <Textarea id="re-notes" rows={3} value={strategyNotes} onChange={(e) => setStrategyNotes(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input id="re-act" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Label htmlFor="re-act">{t.common.active}</Label>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input id="re-bridge" type="checkbox" checked={isBridge} onChange={(e) => setIsBridge(e.target.checked)} />
              <Label htmlFor="re-bridge" className="text-xs">
                Это системный мост (ExnessPanelBridge — скрыть из списков роботов и активов)
              </Label>
            </div>
            <div className="sm:col-span-2">
              <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-4" />
                {t.common.save}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
