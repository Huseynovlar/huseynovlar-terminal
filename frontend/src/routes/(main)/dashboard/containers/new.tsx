import { type FormEvent, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/containers/new")({
  component: ContainerCreatePage,
});

function ContainerCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [containerName, setContainerName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hostLabel, setHostLabel] = useState("vps-prod-1");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/ops/containers", {
        method: "POST",
        body: JSON.stringify({
          container_name: containerName.trim(),
          display_name: displayName.trim() || containerName.trim(),
          host_label: hostLabel.trim() || "vps-prod-1",
        }),
      });
      notify.success(t.common.createdSuccess, containerName.trim());
      await navigate({ to: "/dashboard/containers" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.containers.newTitle}
      subtitle={t.containers.subtitle}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/containers" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Button>
      }
    >
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="container_name">{t.containers.containerName}</Label>
              <Input
                id="container_name"
                placeholder="mt5-xau"
                value={containerName}
                onChange={(e) => setContainerName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">{t.containers.displayName}</Label>
              <Input
                id="display_name"
                placeholder="MT5 Gold Execution Node"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="host_label">{t.containers.hostLabel}</Label>
              <Input
                id="host_label"
                placeholder="vps-prod-1"
                value={hostLabel}
                onChange={(e) => setHostLabel(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" nativeButton={false} render={<Link to="/dashboard/containers" />}>
                {t.common.cancel}
              </Button>
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
