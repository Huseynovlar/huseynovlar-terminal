import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { OctagonAlert, Play, Plus, RefreshCw, RotateCcw, Server, Square, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/framework/api-client";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/infrastructure")({
  component: ContainersOpsPage,
});

interface ContainerRow {
  id: string;
  name: string;
  display_name?: string;
  image: string;
  state: string;
  status: string;
}

function ContainersOpsPage() {
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsTitle, setLogsTitle] = useState<string | null>(null);
  const [logsText, setLogsText] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [killAccountId, setKillAccountId] = useState("");
  const [killConfirm, setKillConfirm] = useState("");

  // Add new MT5 Docker container form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContainerName, setNewContainerName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [connectCmd, setConnectCmd] = useState<string | null>(null);

  function loadContainers() {
    apiRequest<ContainerRow[]>("/ops/containers")
      .then((rows) => setContainers(rows))
      .catch(() => setContainers([]));
  }

  useEffect(() => {
    loadContainers();
  }, []);

  async function handleRegisterContainer(e: FormEvent) {
    e.preventDefault();
    if (!newContainerName.trim()) return;
    setStatusMsg(null);
    setConnectCmd(null);
    try {
      const res = await apiRequest<{ name: string; network_cmd: string }>("/ops/containers", {
        method: "POST",
        body: JSON.stringify({
          container_name: newContainerName.trim(),
          display_name: newDisplayName.trim() || newContainerName.trim(),
          host_label: "vps-main",
        }),
      });
      setConnectCmd(res.network_cmd);
      setStatusMsg(`Контейнер ${res.name} добавлен в реестр терминала.`);
      setNewContainerName("");
      setNewDisplayName("");
      loadContainers();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Ошибка регистрации контейнера");
    }
  }

  async function handleAction(name: string, action: "restart" | "start" | "stop") {
    if (!window.confirm(`Выполнить ${action.toUpperCase()} для контейнера ${name}?`)) return;
    setBusy(`${name}:${action}`);
    setStatusMsg(null);
    try {
      await apiRequest(`/ops/containers/${name}/${action}`, { method: "POST" });
      setStatusMsg(`Команда ${action.toUpperCase()} для ${name} выполнена и записана в Audit Log.`);
      loadContainers();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Ошибка docker-socket-proxy");
    } finally {
      setBusy(null);
    }
  }

  async function handleViewLogs(name: string) {
    setLogsTitle(name);
    setLogsText("Загрузка логов...");
    try {
      const res = await apiRequest<{ logs: string }>(`/ops/containers/${name}/logs?tail=80`);
      setLogsText(res.logs || "(логи пусты)");
    } catch (err) {
      setLogsText(err instanceof Error ? err.message : "Контейнер недоступен в preview-режиме");
    }
  }

  async function handleKillSwitch() {
    if (!killAccountId.trim()) return;
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ note: string }>(`/ops/kill-switch/${killAccountId.trim()}`, {
        method: "POST",
        body: JSON.stringify({ confirm_text: killConfirm }),
      });
      setStatusMsg(`Kill-Switch поставлен в очередь: ${res.note}`);
      setKillConfirm("");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Ошибка Kill-Switch");
    }
  }

  return (
    <TerminalPageShell
      title="Контейнеры MT5 / ОС и Аварийный Kill-Switch"
      subtitle="Добавление и безопасное управление MT5 Docker-контейнерами через docker-socket-proxy (статусы, логи, Restart/Start/Stop)."
      badge="DOCKER OPS"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowAddForm((v) => !v)}>
            <Plus className="size-3.5" />
            Добавить MT5 контейнер
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadContainers}>
            <RefreshCw className="size-3.5" />
            Обновить
          </Button>
        </div>
      }
    >
      {statusMsg ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{statusMsg}</div>
      ) : null}

      {connectCmd ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 font-mono text-xs">
          <div className="mb-1 font-sans text-xs font-medium text-emerald-500">
            Выполните на сервере, чтобы подключить контейнер к Zero-Latency сети MT5:
          </div>
          <code>{connectCmd}</code>
        </div>
      ) : null}

      {showAddForm ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Регистрация нового MT5 Docker-контейнера</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegisterContainer} className="flex flex-wrap gap-2 text-xs">
              <Input
                placeholder="Имя контейнера в Docker (напр. mt5-xauusd-1)"
                value={newContainerName}
                onChange={(e) => setNewContainerName(e.target.value)}
                className="max-w-xs font-mono text-xs"
                required
              />
              <Input
                placeholder="Понятное название (напр. MT5 Gold Pro)"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="max-w-xs text-xs"
              />
              <Button type="submit" size="sm">
                Сохранить контейнер
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {containers.map((c) => (
          <Card key={c.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 font-mono text-sm">
                  <Server className="size-4 text-blue-500" />
                  {c.display_name || c.name}
                </CardTitle>
                <Badge variant={c.state === "running" ? "default" : "destructive"} className="text-[10px]">
                  {c.state.toUpperCase()}
                </Badge>
              </div>
              <div className="text-muted-foreground font-mono text-[11px]">
                {c.name} • {c.status}
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-xs"
                disabled={busy === `${c.name}:restart`}
                onClick={() => handleAction(c.name, "restart")}
              >
                <RotateCcw className="size-3" />
                Restart
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => handleAction(c.name, "start")}
              >
                <Play className="size-3" />
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs text-rose-500"
                onClick={() => handleAction(c.name, "stop")}
              >
                <Square className="size-3" />
                Stop
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleViewLogs(c.name)}>
                <Terminal className="size-3" />
                Логи
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {logsTitle ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs">Логи контейнера: {logsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 max-h-64 overflow-auto rounded-lg p-3 font-mono text-[11px]">{logsText}</pre>
          </CardContent>
        </Card>
      ) : null}

      {/* Emergency Opt-In Kill-Switch */}
      <Card className="border-rose-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-rose-500">
            <OctagonAlert className="size-4" />
            Аварийный Kill-Switch (Закрыть все позиции по счёту)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-xs">
          <p className="text-muted-foreground">
            По умолчанию отключён на уровне терминала. Команда исполнится только если в{" "}
            <code>ExnessPanelBridge.mq5</code> вручную включён предохранитель <code>AllowRemoteClose = true</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Account ID"
              value={killAccountId}
              onChange={(e) => setKillAccountId(e.target.value)}
              className="max-w-xs font-mono text-xs"
            />
            <Input
              placeholder="Введите точно: CLOSE ALL"
              value={killConfirm}
              onChange={(e) => setKillConfirm(e.target.value)}
              className="max-w-xs font-mono text-xs"
            />
            <Button size="sm" variant="destructive" onClick={handleKillSwitch} disabled={killConfirm !== "CLOSE ALL"}>
              Активировать Kill-Switch
            </Button>
          </div>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
