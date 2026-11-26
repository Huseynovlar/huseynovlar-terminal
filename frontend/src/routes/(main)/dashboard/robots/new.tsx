import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { TickerSelect } from "@/framework/components/TickerSelect";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/robots/new")({
  component: RobotCreatePage,
});

function RobotCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mt5_login: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [magicNumber, setMagicNumber] = useState("10001");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [programName, setProgramName] = useState("GoldPulseReversion.mq5");
  const [version, setVersion] = useState("8.1.0");
  const [strategyNotes, setStrategyNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<Array<{ id: string; name: string; mt5_login: string }>>("/accounts")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setAccounts(list);
        if (list[0]) setAccountId(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accountId) {
      notify.error(t.common.errorTitle, "Выберите торговый счёт");
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string }>("/robots", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          name: name.trim(),
          magic_number: Number(magicNumber) || 0,
          symbol: symbol.trim().toUpperCase(),
          program_name: programName.trim(),
          version: version.trim(),
          strategy_notes: strategyNotes.trim(),
        }),
      });
      notify.success(t.common.createdSuccess, name);
      void navigate({ to: "/dashboard/robots/$robotId", params: { robotId: created.id } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.robots.newTitle}
      actions={
        <Link
          to="/dashboard/robots"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.robots.newTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="r-acc">Торговый счёт MT5</Label>
              <SearchSelect
                id="r-acc"
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">Выбери счёт...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (#{a.mt5_login})
                  </option>
                ))}
              </SearchSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-name">Название робота</Label>
              <Input
                id="r-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="GoldPulseReversion v8.1.0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-magic">{t.robots.magicNumber}</Label>
              <Input
                id="r-magic"
                type="number"
                required
                value={magicNumber}
                onChange={(e) => setMagicNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-sym">Символ (поиск и пагинация из справочника тикеров)</Label>
              <TickerSelect
                id="r-sym"
                value={symbol}
                onSelectTicker={(sym) => setSymbol(sym)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-prog">{t.robots.programName}</Label>
              <Input id="r-prog" value={programName} onChange={(e) => setProgramName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-ver">{t.robots.version}</Label>
              <Input id="r-ver" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="r-notes">{t.robots.strategyNotes}</Label>
              <Textarea id="r-notes" rows={3} value={strategyNotes} onChange={(e) => setStrategyNotes(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-4" />
                {t.common.create}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
