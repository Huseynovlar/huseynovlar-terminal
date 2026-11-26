import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, RefreshCw, Save, X } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { type MarketTickerRecord, TickerSelect } from "@/framework/components/TickerSelect";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import type { AssetHubItem } from "@/routes/(main)/dashboard/hubs/index";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/edit")({
  component: HubEditPage,
});

function HubEditPage() {
  const { code } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("macro");
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [newsKeywords, setNewsKeywords] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");

  useEffect(() => {
    apiRequest<AssetHubItem>(`/assets/${encodeURIComponent(code)}`)
      .then((res) => {
        setName(res.name);
        setGroup(res.group || "macro");
        setBrokerSymbols((res.broker_symbols ?? []).join(", "));
        setNewsKeywords(res.news_tags ?? []);
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [code, t.common.errorTitle]);

  async function handleFillFromDirectory() {
    try {
      const rows = await apiRequest<MarketTickerRecord[]>(
        `/assets/tickers?q=${encodeURIComponent(code)}&limit=5`,
      );
      const exact = (rows ?? []).find((r) => r.symbol === code.toUpperCase()) ?? rows?.[0];
      if (exact) {
        if (exact.broker_symbols?.length) {
          setBrokerSymbols(exact.broker_symbols.join(", "));
        }
        if (exact.news_keywords?.length) {
          setNewsKeywords((prev) => Array.from(new Set([...prev, ...exact.news_keywords!])));
        }
        notify.success("Ключевые слова подтянуты из справочника", exact.symbol);
      }
    } catch {
      // ignore
    }
  }

  function handleAddCustomTag() {
    const clean = customTag.trim();
    if (!clean) return;
    const parts = clean
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setNewsKeywords((prev) => Array.from(new Set([...prev, ...parts])));
    setCustomTag("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          group,
          category: group,
          broker_symbols: brokerSymbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          news_tags: newsKeywords,
        }),
      });
      notify.success(t.common.savedSuccess, code);
      void navigate({ to: "/dashboard/hubs/$code", params: { code } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={`${t.hubs.editTitle}: ${code}`}
      actions={
        <Link
          to="/dashboard/hubs/$code"
          params={{ code }}
          className="inline-flex h-8 items-center rounded-[4px] border border-[#1E2634] px-3 text-xs font-medium hover:bg-[#171E2B]"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Link>
      }
    >
      <Card className="max-w-2xl rounded-[4px] border-[#1E2634] bg-[#11161F] shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AssetLogo symbol={code} size={22} />
            {t.hubs.editTitle} — {code}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="he-name">Название</Label>
              <Input id="he-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="he-grp">Группа</Label>
              <SearchSelect
                id="he-grp"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="h-9 w-full rounded-[4px] border border-input bg-background px-2.5 text-xs"
              >
                <option value="metals">Metals</option>
                <option value="indices">Indices</option>
                <option value="forex">Forex</option>
                <option value="crypto">Crypto</option>
                <option value="commodities">Commodities</option>
                <option value="equities">Equities</option>
                <option value="macro">Macro</option>
              </SearchSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="he-syms">Символы брокера MT5</Label>
              <Input id="he-syms" value={brokerSymbols} onChange={(e) => setBrokerSymbols(e.target.value)} />
            </div>

            <div className="space-y-2 rounded-[4px] border border-[#1E2634] bg-[#0B0E14] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Ключевые слова новостей (из справочника тикеров)</Label>
                <Button type="button" size="xs" variant="outline" onClick={() => void handleFillFromDirectory()}>
                  <RefreshCw className="mr-1 size-3" />
                  Подтянуть слова для {code}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {newsKeywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="inline-flex items-center gap-1 text-[11px]">
                    {kw}
                    <button
                      type="button"
                      onClick={() => setNewsKeywords((prev) => prev.filter((x) => x !== kw))}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                    >
                      <X className="size-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                <TickerSelect
                  value=""
                  placeholder="+ Добавить слова другого тикера (DXY, BTC...)"
                  onSelectTicker={(_s, rec) => {
                    if (rec?.news_keywords?.length) {
                      setNewsKeywords((prev) => Array.from(new Set([...prev, ...rec.news_keywords!])));
                    }
                  }}
                />
                <div className="flex gap-1.5">
                  <Input
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomTag();
                      }
                    }}
                    placeholder="Своё слово (Enter)..."
                    className="h-9 text-xs"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={handleAddCustomTag}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
              <Save className="mr-1.5 size-4" />
              {t.common.save}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
