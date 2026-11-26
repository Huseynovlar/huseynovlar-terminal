import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Save, X } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { type MarketTickerRecord, TickerSelect } from "@/framework/components/TickerSelect";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/hubs/new")({
  component: HubCreatePage,
});

interface AccountOpt {
  id: string;
  name: string;
  mt5_login: string;
  currency?: string;
}

function HubCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("metals");
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [newsKeywords, setNewsKeywords] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<AccountOpt[]>("/accounts")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setAccounts(list);
        if (list.length > 0 && list[0]) setLinkedAccountId(list[0].id);
      })
      .catch(() => {});

    // Support ?ticker=XAUUSD deep-link from /dashboard/tickers
    if (typeof window !== "undefined") {
      const pre = new URLSearchParams(window.location.search).get("ticker");
      if (pre && pre.trim()) {
        const sym = pre.trim().toUpperCase();
        apiRequest<MarketTickerRecord[]>(`/assets/tickers?q=${encodeURIComponent(sym)}&limit=5`)
          .then((rows) => {
            const exact = (rows ?? []).find((r) => r.symbol === sym) ?? rows?.[0];
            if (exact) {
              applyTickerRecord(exact.symbol, exact);
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  function applyTickerRecord(sym: string, record?: MarketTickerRecord) {
    setCode(sym);
    if (record) {
      setName(record.name);
      if (record.asset_class) setGroup(record.asset_class);
      if (record.broker_symbols && record.broker_symbols.length > 0) {
        setBrokerSymbols(record.broker_symbols.join(", "));
      } else {
        setBrokerSymbols(`${sym}, ${sym}c, ${sym}m`);
      }
      if (record.news_keywords && record.news_keywords.length > 0) {
        setNewsKeywords(Array.from(new Set(record.news_keywords)));
      } else {
        setNewsKeywords([sym]);
      }
    } else {
      setBrokerSymbols(sym);
      setNewsKeywords([sym]);
    }
  }

  function mergeRelatedTickerKeywords(_sym: string, record?: MarketTickerRecord) {
    if (!record?.news_keywords?.length) return;
    setNewsKeywords((prev) => Array.from(new Set([...prev, ...record.news_keywords!])));
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

  function removeKeyword(kw: string) {
    setNewsKeywords((prev) => prev.filter((x) => x !== kw));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      notify.error(t.common.errorTitle, "Выберите тикер из справочника");
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string; code: string }>("/assets", {
        method: "POST",
        body: JSON.stringify({
          code: cleanCode,
          name: name.trim() || cleanCode,
          group,
          category: group,
          broker_symbols: brokerSymbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          news_tags: newsKeywords.length > 0 ? newsKeywords : [cleanCode],
        }),
      });
      if (linkedAccountId && created?.id) {
        await apiRequest(`/accounts/${encodeURIComponent(linkedAccountId)}`, {
          method: "PATCH",
          body: JSON.stringify({ primary_asset_id: created.id }),
        }).catch(() => {});
      }
      notify.success(t.common.createdSuccess, created.code || cleanCode);
      void navigate({ to: "/dashboard/hubs/$code", params: { code: created.code || cleanCode } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.hubs.newTitle}
      actions={
        <Link
          to="/dashboard/hubs"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Link>
      }
    >
      <Card className="max-w-2xl border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            {code ? <AssetLogo symbol={code} size={22} /> : null}
            {t.hubs.newTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="h-account">Привязанный торговый счёт MT5 (необязательно — счета также распознаются по символу)</Label>
              <SearchSelect
                id="h-account"
                value={linkedAccountId}
                onChange={(e) => setLinkedAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">— Автоматическое распознавание по символу —</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} — MT5 #{acc.mt5_login} ({acc.currency || "USD"})
                  </option>
                ))}
              </SearchSelect>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="h-code">Тикер (поиск и подгрузка из справочника)</Label>
                <TickerSelect
                  id="h-code"
                  required
                  value={code}
                  onSelectTicker={applyTickerRecord}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="h-group">Группа / Класс актива</Label>
                <SearchSelect
                  id="h-group"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="metals">Metals (Металлы)</option>
                  <option value="indices">Indices (Индексы)</option>
                  <option value="forex">Forex (Валюты)</option>
                  <option value="crypto">Crypto (Криптовалюты)</option>
                  <option value="commodities">Commodities (Сырьё)</option>
                  <option value="equities">Equities (Акции / ETF)</option>
                  <option value="macro">Macro</option>
                </SearchSelect>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="h-name">Название актива</Label>
              <Input
                id="h-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Gold Spot / US Dollar"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="h-syms">Символы брокера MT5 (подставляются автоматически)</Label>
              <Input
                id="h-syms"
                value={brokerSymbols}
                onChange={(e) => setBrokerSymbols(e.target.value)}
                placeholder="XAUUSD, XAUUSDc, XAUUSDm, GOLD"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Ключевые слова новостей (подтягиваются из справочника тикеров)</Label>
                <span className="font-mono text-[10px] text-muted-foreground">
                  Выбрано: {newsKeywords.length}
                </span>
              </div>

              {newsKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {newsKeywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="inline-flex items-center gap-1 text-[11px]">
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(kw)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                        title="Удалить тег"
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Выбери основной тикер выше — все связанные новостные кодовые слова (крипта, макро, ЦБ, сектор) подставятся автоматически.
                </p>
              )}

              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                <div>
                  <TickerSelect
                    value=""
                    placeholder="+ Добавить ключевые слова из другого тикера (DXY, BTC...)"
                    onSelectTicker={mergeRelatedTickerKeywords}
                  />
                </div>
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
              {t.common.create}
            </AsyncButton>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
