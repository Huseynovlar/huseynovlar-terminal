import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, CheckCircle2, Copy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/academy")({
  component: SetupWizardAndWikiPage,
});

const DOCKER_CONNECT_SNIPPET = `# 1. Создать общую внутреннюю сеть MT5 (один раз на VPS)
docker network create exness_mt5_ingest --internal || true

# 2. Подключить существующий MT5-контейнер к внутренней сети (<1 мс, без интернета)
docker network connect exness_mt5_ingest mt5-xauusd-usd

# 3. В docker-compose.yml каждого управляемого MT5-контейнера добавить метку:
#    labels:
#      - "exness-panel.managed=true"`;

function SetupWizardAndWikiPage() {
  const [accountId, setAccountId] = useState("");
  const [copied, setCopied] = useState(false);

  function copySnippet() {
    navigator.clipboard.writeText(DOCKER_CONNECT_SNIPPET).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <TerminalPageShell
      title="Инструкции, Setup Wizard и База знаний"
      subtitle="Пошаговое подключение нового счёта Exness (USD / USC), автогенерация .set-файла для MT5 и регламенты."
      badge="WIKI & WIZARD"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Download className="size-4 text-emerald-500" />
              Шаг 1. Генератор .set-файла для ExnessPanelBridge.mq5
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-muted-foreground">
              Создайте счёт в разделе <strong>Счета и роботы</strong>, скопируйте его ID и скачайте готовый пресет для
              MT5 (внутри уже прописан внутренний URL <code>http://terminal-backend:8000/api/v1/ingest</code> и{" "}
              <code>AllowRemoteClose=false</code>).
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Account ID из раздела Счета"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={!accountId.trim()}
                onClick={() => window.open(`/api/v1/ops/setup-wizard/${accountId.trim()}/bridge.set`, "_blank")}
              >
                Скачать .set
              </Button>
            </div>
            <ol className="text-muted-foreground list-inside list-decimal space-y-1 pt-1">
              <li>
                В MT5 откройте <strong>Tools → Options → Expert Advisors → Allow WebRequest</strong> и добавьте{" "}
                <code>http://terminal-backend:8000</code>.
              </li>
              <li>
                Поместите <code>ExnessPanelBridge.mq5</code> в <code>MQL5/Experts/</code> и скомпилируйте в MetaEditor.
              </li>
              <li>Откройте вспомогательный график (отдельный поток MT5), перетащите Bridge EA и загрузите .set-файл.</li>
              <li>
                (Опционально) В ваши торговые <code>.mq5</code> роботы добавьте <code>#include &lt;ExnessPanelHook.mqh&gt;</code> — 0 сетевых вызовов, задержка &lt; 0.05 мс.
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4 text-blue-500" />
              Шаг 2. Подключение MT5 Docker-контейнера
            </CardTitle>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={copySnippet}>
              {copied ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              {copied ? "Скопировано" : "Копировать"}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed">
              {DOCKER_CONNECT_SNIPPET}
            </pre>
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
