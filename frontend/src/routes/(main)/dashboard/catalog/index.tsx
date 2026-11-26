import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, ImagePlus, Pencil, Plus, RefreshCw, Save, Search, Sparkles, Trash2, X } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { SearchSelect } from "@/components/ui/search-select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged, apiRequestRaw } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/catalog/")({
  component: AssetCatalogPage,
});

interface CatalogAssetItem {
  id: string;
  code: string;
  name: string;
  group: string;
  category: string;
  status: string;
  logo_url?: string | null;
  broker_symbols: string[];
  news_tags: string[];
}

const CATEGORIES = ["ALL", "metals", "indices", "forex", "crypto", "commodities", "equities", "macro"] as const;

const LOCAL_ICON_PACK: Array<{ code: string; url: string }> = [
  { code: "XAU", url: "/logos/xau.svg" },
  { code: "XAG", url: "/logos/xag.svg" },
  { code: "USTEC", url: "/logos/ustec.svg" },
  { code: "SPX", url: "/logos/spx.svg" },
  { code: "US30", url: "/logos/us30.svg" },
  { code: "DXY", url: "/logos/dxy.svg" },
  { code: "VIX", url: "/logos/vix.svg" },
  { code: "US10Y", url: "/logos/us10y.svg" },
  { code: "OIL", url: "/logos/oil.svg" },
  { code: "NGAS", url: "/logos/ngas.svg" },
  { code: "BTC", url: "/logos/btc.svg" },
  { code: "ETH", url: "/logos/eth.svg" },
  { code: "SOL", url: "/logos/sol.svg" },
  { code: "BNB", url: "/logos/bnb.svg" },
  { code: "XRP", url: "/logos/xrp.svg" },
  { code: "ADA", url: "/logos/ada.svg" },
  { code: "DOGE", url: "/logos/doge.svg" },
  { code: "TON", url: "/logos/ton.svg" },
  { code: "LTC", url: "/logos/ltc.svg" },
  { code: "AAPL", url: "/logos/aapl.svg" },
  { code: "NVDA", url: "/logos/nvda.svg" },
  { code: "TSLA", url: "/logos/tsla.svg" },
  { code: "MSFT", url: "/logos/msft.svg" },
  { code: "AMZN", url: "/logos/amzn.svg" },
  { code: "META", url: "/logos/meta.svg" },
  { code: "GOOGL", url: "/logos/googl.svg" },
];

function AssetCatalogPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<CatalogAssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogAssetItem | null>(null);

  // Create / Edit state
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("metals");
  const [category, setCategory] = useState("metals");
  const [logoUrl, setLogoUrl] = useState("");
  const [brokerSymbols, setBrokerSymbols] = useState("");
  const [newsTags, setNewsTags] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (categoryFilter !== "ALL") params.set("category", categoryFilter);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiRequestPaged<CatalogAssetItem>(`/assets${qs}`, page, DEFAULT_PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, debouncedQ, page, t.common.errorTitle]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  function resetForm() {
    setEditingCode(null);
    setCode("");
    setName("");
    setGroup("metals");
    setCategory("metals");
    setLogoUrl("");
    setBrokerSymbols("");
    setNewsTags("");
  }

  function startEdit(item: CatalogAssetItem) {
    setEditingCode(item.code);
    setCode(item.code);
    setName(item.name);
    setGroup(item.group || "other");
    setCategory(item.category || "macro");
    setLogoUrl(item.logo_url || "");
    setBrokerSymbols((item.broker_symbols || []).join(", "));
    setNewsTags((item.news_tags || []).join(", "));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const syms = brokerSymbols
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = newsTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (editingCode) {
        await apiRequest(`/assets/${encodeURIComponent(editingCode)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            group,
            category,
            logo_url: logoUrl.trim() || null,
            broker_symbols: syms.length > 0 ? syms : [code.trim().toUpperCase()],
            news_tags: tags,
          }),
        });
        notify.success(t.common.savedSuccess, editingCode);
      } else {
        const cleanCode = code.trim().toUpperCase();
        await apiRequest("/assets", {
          method: "POST",
          body: JSON.stringify({
            code: cleanCode,
            name: name.trim(),
            group,
            category,
            logo_url: logoUrl.trim() || null,
            broker_symbols: syms.length > 0 ? syms : [cleanCode],
            news_tags: tags,
          }),
        });
        notify.success(t.common.createdSuccess, cleanCode);
      }
      resetForm();
      await loadCatalog();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadLogo(assetCode: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingCode(assetCode);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiRequestRaw(`/assets/${encodeURIComponent(assetCode)}/logo`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { detail?: string };
          if (j.detail) msg = j.detail;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      notify.success("Логотип обновлён", assetCode);
      await loadCatalog();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingCode(null);
    }
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      await apiRequest("/assets/seed-defaults", { method: "POST" });
      notify.success(t.hubs.seedDefaults);
      await loadCatalog();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(deleteTarget.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, deleteTarget.code);
      setDeleteTarget(null);
      await loadCatalog();
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title="Каталог активов и иконок"
      subtitle="CRUD справочник всех инструментов, локальный SVG-пак и загрузка собственных логотипов (#26)"
      badge={`${total} активов`}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={seeding}
            loadingText={t.common.processing}
            onClick={() => void handleSeedDefaults()}
          >
            <Sparkles className="mr-1.5 size-3.5" />
            {t.hubs.seedDefaults}
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => void loadCatalog()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
        </>
      }
    >
      {/* Create / Edit Form + Local Icon Pack Picker */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">
            {editingCode ? `Редактировать актив: ${editingCode}` : "Добавить актив в каталог"}
          </CardTitle>
          {editingCode ? (
            <Button size="xs" variant="ghost" onClick={resetForm}>
              <X className="mr-1 size-3.5" />
              Отмена
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="cat-code">Тикер (Code)</Label>
              <Input
                id="cat-code"
                required
                disabled={Boolean(editingCode)}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XAUUSD"
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-name">Название</Label>
              <Input
                id="cat-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Gold Spot / USD"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-category">Категория</Label>
              <SearchSelect
                id="cat-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setGroup(e.target.value);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
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
              <Label htmlFor="cat-syms">Символы брокера (через запятую)</Label>
              <Input
                id="cat-syms"
                value={brokerSymbols}
                onChange={(e) => setBrokerSymbols(e.target.value)}
                placeholder="XAUUSDm, XAUUSDc, XAUUSD"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-tags">Теги новостей</Label>
              <Input
                id="cat-tags"
                value={newsTags}
                onChange={(e) => setNewsTags(e.target.value)}
                placeholder="gold, fed, inflation"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-logo">URL логотипа (или выбери ниже)</Label>
              <div className="flex items-center gap-2">
                <AssetLogo symbol={code || "XAU"} logoUrl={logoUrl || null} size={28} />
                <Input
                  id="cat-logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="/logos/xau.svg"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Local 26-icon SVG Pack Selector */}
            <div className="space-y-1.5 sm:col-span-3">
              <Label className="text-[11px] text-muted-foreground">
                Локальный SVG-пак иконок ({LOCAL_ICON_PACK.length} шт. — кликни для выбора):
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {LOCAL_ICON_PACK.map((ic) => {
                  const selected = logoUrl === ic.url;
                  return (
                    <button
                      key={ic.code}
                      type="button"
                      onClick={() => setLogoUrl(ic.url)}
                      title={ic.code}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10px] transition ${
                        selected
                          ? "border-primary bg-primary/15 text-primary ring-1 ring-primary/40"
                          : "border-border/60 bg-muted/30 hover:border-primary/50"
                      }`}
                    >
                      <img src={ic.url} alt={ic.code} className="size-4 rounded-sm" />
                      <span>{ic.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sm:col-span-3 pt-1">
              <AsyncButton type="submit" size="sm" loading={saving} loadingText={t.common.saving}>
                {editingCode ? <Save className="mr-1.5 size-3.5" /> : <Plus className="mr-1.5 size-3.5" />}
                {editingCode ? t.common.save : t.common.create}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Search & Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по тикеру, названию или ID..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              size="xs"
              variant={categoryFilter === cat ? "default" : "outline"}
              className="font-mono text-[10px] uppercase"
              onClick={() => {
                setCategoryFilter(cat);
                setPage(1);
              }}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Catalog Table */}
      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">{t.common.noData}</CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2">Актив</th>
                  <th className="px-3 py-2">Категория</th>
                  <th className="px-3 py-2">Символы брокера</th>
                  <th className="px-3 py-2">Логотип</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[11px]" title={a.id}>
                      <Link to="/dashboard/hubs/$code" params={{ code: a.code }} className="text-primary hover:underline">
                        {a.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <AssetLogo symbol={a.code} logoUrl={a.logo_url} size={26} />
                        <div>
                          <div className="font-mono font-bold">{a.code}</div>
                          <div className="text-[11px] text-muted-foreground">{a.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {a.category || a.group}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {(a.broker_symbols || []).join(", ") || a.code}
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-input px-2 text-[11px] hover:bg-accent">
                        <ImagePlus className="size-3.5" />
                        <span>{uploadingCode === a.code ? "..." : "Загрузить"}</span>
                        <input
                          type="file"
                          accept="image/png,image/webp,image/jpeg,image/svg+xml"
                          className="hidden"
                          onChange={(e) => void handleUploadLogo(a.code, e)}
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Link
                          to="/dashboard/hubs/$code"
                          params={{ code: a.code }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                          title="Открыть Хаб"
                        >
                          <Eye className="size-3.5" />
                        </Link>
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => startEdit(a)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PagerBar page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} onPage={setPage} />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.common.delete}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : ""}
        loading={saving}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
