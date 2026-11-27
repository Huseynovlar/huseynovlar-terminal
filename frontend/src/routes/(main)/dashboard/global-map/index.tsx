import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Compass, ExternalLink, Radio, ShieldAlert, Ship } from "lucide-react";
import { setWorkerUrl } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { type LiveNewsItem, stripHtmlSafe, useNewsStream } from "@/framework/use-news-stream";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

// MapLibre v6 needs an explicit bundled worker URL in Vite production builds.
setWorkerUrl(maplibreWorkerUrl);

export const Route = createFileRoute("/(main)/dashboard/global-map/")({
  component: GlobalBmapPage,
});

interface Chokepoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  zoom: number;
}

interface VesselItem {
  mmsi: string;
  name: string;
  flag: string;
  cargo_type: "Tanker" | "LNG" | "Cargo" | string;
  lat: number;
  lon: number;
  speed_knots: number;
  course: number;
  destination: string;
  chokepoint: string;
  updated_at_utc: string;
}

interface GdeltEventItem {
  id: string;
  title: string;
  category: string;
  lat: number;
  lon: number;
  severity: "high" | "medium" | "low" | string;
  url: string;
  domain: string;
}

interface BmapResponse {
  updated_at_utc: string;
  chokepoints: Chokepoint[];
  vessels: VesselItem[];
  alert_banner: {
    id: string;
    title: string;
    source: string;
    sentiment: string;
    published_at: string;
  } | null;
}

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";

function vesselColor(cargoType: string): string {
  if (cargoType === "Tanker") return "#F59E0B"; // amber
  if (cargoType === "LNG") return "#38BDF8"; // cyan/blue
  return "#94A3B8"; // slate/gray
}

function GlobalBmapPage() {
  const isDark = usePreferencesStore((s) => s.resolvedThemeMode) !== "light";

  const [data, setData] = useState<BmapResponse | null>(null);
  const [gdeltEvents, setGdeltEvents] = useState<GdeltEventItem[]>([]);
  const [activeChokepoint, setActiveChokepoint] = useState<string>("hormuz");
  const [selectedVessel, setSelectedVessel] = useState<VesselItem | null>(null);
  const [selectedGdelt, setSelectedGdelt] = useState<GdeltEventItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bannerNews, setBannerNews] = useState<BmapResponse["alert_banner"]>(null);

  // Layer toggles per spec
  const [showVessels, setShowVessels] = useState(true);
  const [showGdelt, setShowGdelt] = useState(true);
  const [showChokepoints, setShowChokepoints] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    apiRequest<BmapResponse>("/institutional/bmap")
      .then((res) => {
        setData(res);
        setBannerNews(res.alert_banner);
      })
      .catch((err) => {
        notify.error("Ошибка загрузки BMAP", err instanceof Error ? err.message : String(err));
      });

    apiRequest<{ items: GdeltEventItem[] }>("/pro/bmap/gdelt")
      .then((res) => setGdeltEvents(res.items || []))
      .catch(() => {
        // non-blocking
      });
  }, []);

  // Subscribe to /ws/news for live High-Impact shipping/oil banner updates (auto-unsubscribes on unmount)
  const handleNews = useCallback((item: LiveNewsItem) => {
    const tl = item.title.toLowerCase();
    const kws = ["oil", "eia", "opec", "hormuz", "red sea", "suez", "tanker", "lng", "shipping", "brent", "wti"];
    if (kws.some((k) => tl.includes(k))) {
      setBannerNews({
        id: item.id,
        title: stripHtmlSafe(item.title),
        source: item.source,
        sentiment: item.sentiment,
        published_at: item.published_at,
      });
    }
  }, []);
  useNewsStream(handleNews);

  // Initialize MapLibre GL JS canvas
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;

    const map = new maplibregl.Map({
      container: el,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [56.25, 26.56],
      zoom: 6.5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-left");
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      for (const mk of markersRef.current) mk.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch MapLibre style seamlessly when Dark/Light theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(isDark ? DARK_STYLE : LIGHT_STYLE);
  }, [isDark]);

  // Render AIS Vessels + GDELT Geopolitics + Chokepoint markers on MapLibre canvas
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const mk of markersRef.current) mk.remove();
    markersRef.current = [];

    if (showChokepoints && data?.chokepoints) {
      for (const cp of data.chokepoints) {
        const ring = document.createElement("button");
        ring.type = "button";
        ring.title = `Пролив: ${cp.name}`;
        ring.style.width = "18px";
        ring.style.height = "18px";
        ring.style.borderRadius = "9999px";
        ring.style.border = "2px dashed #3B82F6";
        ring.style.backgroundColor = "rgba(59,130,246,0.15)";
        ring.style.cursor = "pointer";
        ring.onclick = () => flyToChokepoint(cp);
        markersRef.current.push(new maplibregl.Marker({ element: ring }).setLngLat([cp.lon, cp.lat]).addTo(map));
      }
    }

    if (showVessels && data?.vessels) {
      for (const v of data.vessels) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.title = `${v.name} (${v.cargo_type}) · ${v.speed_knots} kn`;
        dot.style.width = "12px";
        dot.style.height = "12px";
        dot.style.borderRadius = "9999px";
        dot.style.backgroundColor = vesselColor(v.cargo_type);
        dot.style.border = "2px solid #0B0E14";
        dot.style.cursor = "pointer";
        dot.onclick = () => {
          setSelectedGdelt(null);
          setSelectedVessel(v);
          setSidebarOpen(true);
        };
        markersRef.current.push(new maplibregl.Marker({ element: dot }).setLngLat([v.lon, v.lat]).addTo(map));
      }
    }

    if (showGdelt && gdeltEvents.length) {
      for (const ev of gdeltEvents) {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.title = `[GDELT] ${ev.title}`;
        pin.style.width = "13px";
        pin.style.height = "13px";
        pin.style.transform = "rotate(45deg)";
        pin.style.backgroundColor = ev.severity === "high" ? "#F43F5E" : "#F59E0B";
        pin.style.border = "1.5px solid #FFFFFF";
        pin.style.cursor = "pointer";
        pin.onclick = () => {
          setSelectedVessel(null);
          setSelectedGdelt(ev);
          setSidebarOpen(true);
        };
        markersRef.current.push(new maplibregl.Marker({ element: pin }).setLngLat([ev.lon, ev.lat]).addTo(map));
      }
    }
  }, [data?.vessels, data?.chokepoints, gdeltEvents, showVessels, showGdelt, showChokepoints]);

  function flyToChokepoint(cp: Chokepoint) {
    setActiveChokepoint(cp.id);
    mapRef.current?.flyTo({
      center: [cp.lon, cp.lat],
      zoom: cp.zoom,
      duration: 1100,
    });
  }

  const zoneVessels = useMemo(() => {
    const list = data?.vessels ?? [];
    const inZone = list.filter((v) => v.chokepoint === activeChokepoint);
    return inZone.length > 0 ? inZone : list;
  }, [data?.vessels, activeChokepoint]);

  const zoneStats = useMemo(() => {
    const tankers = zoneVessels.filter((v) => v.cargo_type === "Tanker" || v.cargo_type === "LNG").length;
    const anchored = zoneVessels.filter((v) => v.speed_knots < 0.5).length;
    const avgSpeed =
      zoneVessels.length > 0
        ? zoneVessels.reduce((s, v) => s + v.speed_knots, 0) / zoneVessels.length
        : 0;
    return { total: zoneVessels.length, tankers, anchored, avgSpeed };
  }, [zoneVessels]);

  return (
    <div
      data-content-padding="false"
      className="relative flex h-[calc(100vh-52px)] w-full flex-col overflow-hidden bg-[var(--bg-canvas)] font-sans text-[var(--text-primary)]"
    >
      {/* Top Chokepoint Teleport & Layer Toggle Bar */}
      <div className="z-20 flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1">
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <span className="mr-1 hidden items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)] md:inline-flex">
            <Compass className="size-3.5 text-[var(--accent-blue)]" />
            BMAP:
          </span>
          {(data?.chokepoints ?? []).map((cp) => (
            <button
              key={cp.id}
              type="button"
              onClick={() => flyToChokepoint(cp)}
              className={`shrink-0 rounded-[4px] border px-2 py-1 text-[11px] font-medium transition-colors ${
                activeChokepoint === cp.id
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {cp.name}
            </button>
          ))}
        </div>

        {/* 3 Layer Toggles + Sidebar Toggle */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10.5px]">
          <label className="flex cursor-pointer items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[var(--text-secondary)]">
            <input type="checkbox" checked={showVessels} onChange={(e) => setShowVessels(e.target.checked)} />
            <span>Танкеры и суда (AIS)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[var(--text-secondary)]">
            <input type="checkbox" checked={showGdelt} onChange={(e) => setShowGdelt(e.target.checked)} />
            <span className="text-[var(--bear)]">Геополитика (GDELT {gdeltEvents.length})</span>
          </label>
          <label className="hidden cursor-pointer items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[var(--text-secondary)] lg:flex">
            <input type="checkbox" checked={showChokepoints} onChange={(e) => setShowChokepoints(e.target.checked)} />
            <span>Ключевые проливы</span>
          </label>
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            {sidebarOpen ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
            Инспектор
          </button>
        </div>
      </div>

      {/* Main Map Canvas + Right Collapsible 320px Sidebar */}
      <div className="relative flex min-h-[calc(100vh-110px)] flex-1">
        <div
          ref={mapContainerRef}
          className="h-full min-h-[calc(100vh-110px)] w-full flex-1"
          style={{ minHeight: "calc(100vh - 110px)" }}
        />

        {/* Collapsible Right Inspector Sidebar (320px) */}
        {sidebarOpen && (
          <aside className="z-10 flex w-[320px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            {/* Selected GDELT Incident Card */}
            {selectedGdelt && (
              <div className="border-b border-[var(--bear)]/40 bg-[var(--bear)]/10 p-2.5 text-[11px]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold uppercase text-[var(--bear)]">
                    <ShieldAlert className="size-3.5" />
                    GDELT · {selectedGdelt.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedGdelt(null)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Закрыть
                  </button>
                </div>
                <p className="font-medium leading-snug text-[var(--text-primary)]">{selectedGdelt.title}</p>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[var(--text-muted)]">
                  <span>
                    {selectedGdelt.lat.toFixed(2)}, {selectedGdelt.lon.toFixed(2)}
                  </span>
                  <a
                    href={selectedGdelt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-sans font-semibold text-[var(--accent-blue)] hover:underline"
                  >
                    Источник
                    <ExternalLink className="size-2.5" />
                  </a>
                </div>
              </div>
            )}

            {/* Traffic Summary */}
            <div className="grid grid-cols-3 gap-px border-b border-[var(--border-subtle)] bg-[var(--border-subtle)] text-center tabular-nums">
              <div className="bg-[var(--bg-panel)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Танкеров</div>
                <div className="text-[14px] font-semibold text-[var(--accent-amber)]">
                  {zoneStats.tankers}
                </div>
              </div>
              <div className="bg-[var(--bg-panel)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">Ср. узлы</div>
                <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {zoneStats.avgSpeed.toFixed(1)}
                </div>
              </div>
              <div className="bg-[var(--bg-panel)] p-2">
                <div className="text-[9px] uppercase text-[var(--text-muted)]">На якоре</div>
                <div className="text-[14px] font-semibold text-[var(--text-secondary)]">
                  {zoneStats.anchored}
                </div>
              </div>
            </div>

            {/* Selected Vessel Detail Card */}
            {selectedVessel && (
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-[11px] tabular-nums">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Ship className="size-3.5" style={{ color: vesselColor(selectedVessel.cargo_type) }} />
                    <span className="font-semibold text-[var(--text-primary)]">
                      {selectedVessel.name}
                    </span>
                  </div>
                  <span className="rounded-[3px] border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] font-semibold">
                    {selectedVessel.cargo_type}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-[10px]">
                  <span className="text-[var(--text-muted)]">MMSI / Флаг</span>
                  <span className="text-right text-[var(--text-primary)]">
                    {selectedVessel.mmsi} · {selectedVessel.flag}
                  </span>
                  <span className="text-[var(--text-muted)]">Скорость / Курс</span>
                  <span className="text-right text-[var(--text-primary)]">
                    {selectedVessel.speed_knots.toFixed(1)} kn · {selectedVessel.course}°
                  </span>
                  <span className="text-[var(--text-muted)]">Назначение</span>
                  <span className="text-right font-medium text-[var(--accent-blue)]">
                    {selectedVessel.destination}
                  </span>
                  <span className="text-[var(--text-muted)]">Обновлено (UTC)</span>
                  <span className="text-right text-[var(--text-secondary)]">
                    {formatTerminalDateTime(selectedVessel.updated_at_utc, { timezone: "UTC" })}
                  </span>
                </div>
              </div>
            )}

            {/* Vessels List in Zone */}
            <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
              {zoneVessels.map((v) => (
                <button
                  key={v.mmsi}
                  type="button"
                  onClick={() => {
                    setSelectedVessel(v);
                    mapRef.current?.flyTo({ center: [v.lon, v.lat], zoom: 8.5, duration: 700 });
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] transition-colors hover:bg-[var(--bg-elevated)]/60 ${
                    selectedVessel?.mmsi === v.mmsi ? "bg-[var(--accent-blue)]/10" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: vesselColor(v.cargo_type) }}
                      />
                      <span className="truncate font-semibold text-[var(--text-primary)]">
                        {v.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {v.cargo_type} · {v.destination}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-[10px] font-medium text-[var(--text-secondary)]">
                    {v.speed_knots.toFixed(1)} kn
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Bottom High-Impact Maritime / Oil News Banner */}
        {bannerNews && (
          <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex max-w-2xl items-center gap-2 rounded-[4px] border border-[var(--accent-amber)]/50 bg-[var(--bg-panel)]/95 px-3 py-1.5 text-[11px]">
            <Radio className="size-3.5 shrink-0 text-[var(--accent-amber)]" />
            <span className="shrink-0 rounded-[2px] bg-[var(--accent-amber)]/15 px-1 py-0.2 text-[9px] font-semibold uppercase text-[var(--accent-amber)]">
              MARITIME ALERT
            </span>
            <span className="truncate font-medium text-[var(--text-primary)]">
              {stripHtmlSafe(bannerNews.title)}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
              · {bannerNews.source}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
