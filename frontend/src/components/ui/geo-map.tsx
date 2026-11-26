import { useState } from "react";

import { MapPin, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

interface GeoLocationMapProps {
  readonly lat: number | null | undefined;
  readonly lon: number | null | undefined;
  readonly label?: string;
  readonly sublabel?: string;
  readonly heightClass?: string;
}

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y, tileX: Math.floor(x), tileY: Math.floor(y) };
}

/**
 * Lightweight, zero-dependency, SSR-safe slippy tile map with automatic
 * Carto Dark Matter (dark theme) / Positron (light theme) tiles (#8).
 */
export function GeoLocationMap({
  lat,
  lon,
  label,
  sublabel,
  heightClass = "h-56",
}: GeoLocationMapProps) {
  const themeMode = usePreferencesStore((s) => s.values.theme_mode);
  const [zoom, setZoom] = useState(10);

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return (
      <div
        className={`flex ${heightClass} w-full flex-col items-center justify-center rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-xs text-muted-foreground`}
      >
        <MapPin className="mb-1.5 size-5 opacity-60" />
        <div>{label || "Private / VPN Network"}</div>
        {sublabel ? <div className="mt-0.5 font-mono text-[10px] opacity-75">{sublabel}</div> : null}
      </div>
    );
  }

  const isDark = themeMode === "dark";
  const tileStyle = isDark ? "dark_all" : "light_all";
  const { x, y, tileX, tileY } = latLonToTile(lat, lon, zoom);
  const offsetX = (x - tileX) * 256;
  const offsetY = (y - tileY) * 256;
  const maxTile = 2 ** zoom;

  const tiles: { key: string; dx: number; dy: number; url: string }[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const tx = ((tileX + dx) % maxTile + maxTile) % maxTile;
      const ty = tileY + dy;
      if (ty < 0 || ty >= maxTile) continue;
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        dx,
        dy,
        url: `https://a.basemaps.cartocdn.com/${tileStyle}/${zoom}/${tx}/${ty}@2x.png`,
      });
    }
  }

  return (
    <div className={`relative ${heightClass} w-full overflow-hidden rounded-lg border border-border/70 bg-muted/40`}>
      <div
        className="pointer-events-none absolute top-1/2 left-1/2"
        style={{
          transform: `translate(${-offsetX}px, ${-offsetY}px)`,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={256}
            height={256}
            loading="lazy"
            className="absolute max-w-none select-none"
            style={{
              left: tile.dx * 256,
              top: tile.dy * 256,
              width: 256,
              height: 256,
            }}
          />
        ))}
      </div>

      {/* Center Pin */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
        <div className="flex flex-col items-center">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full shadow-lg ring-2 ring-background">
            <MapPin className="size-4" />
          </div>
          <div className="bg-primary/40 mt-0.5 h-1.5 w-3 rounded-full blur-[1px]" />
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <Button
          type="button"
          size="icon-xs"
          variant="secondary"
          className="shadow-sm"
          onClick={() => setZoom((z) => Math.min(15, z + 1))}
          aria-label="Zoom in"
        >
          <Plus className="size-3" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="secondary"
          className="shadow-sm"
          onClick={() => setZoom((z) => Math.max(2, z - 1))}
          aria-label="Zoom out"
        >
          <Minus className="size-3" />
        </Button>
      </div>

      {/* Coordinates Badge */}
      <div className="bg-background/85 absolute bottom-2 left-2 rounded border border-border/60 px-2 py-0.5 font-mono text-[10px] backdrop-blur-sm">
        {label ? <span className="mr-1.5 font-semibold">{label}</span> : null}
        <span className="text-muted-foreground">
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </span>
      </div>
    </div>
  );
}
