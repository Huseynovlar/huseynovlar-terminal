import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/containers/$containerId/edit")({
  component: ContainerEditPage,
});

function ContainerEditPage() {
  const { containerId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [hostLabel, setHostLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ display_name?: string; name?: string; host_label?: string }>(
      `/ops/containers/${encodeURIComponent(containerId)}`,
    )
      .then((res) => {
        setDisplayName(res.display_name || res.name || containerId);
        setHostLabel(res.host_label || "vps-prod-1");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [containerId, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/ops/containers/${encodeURIComponent(containerId)}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: displayName.trim(), host_label: hostLabel.trim() }),
      });
      notify.success(t.common.savedSuccess);
      await navigate({ to: "/dashboard/containers/$containerId", params: { containerId } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.containers.editTitle}
      subtitle={containerId}
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/dashboard/containers/$containerId" params={{ containerId }} />}
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.back}
        </Button>
      }
    >
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display_name">{t.containers.displayName}</Label>
              <Input
                id="display_name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="host_label">{t.containers.hostLabel}</Label>
              <Input id="host_label" value={hostLabel} onChange={(e) => setHostLabel(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/dashboard/containers/$containerId" params={{ containerId }} />}
              >
                {t.common.cancel}
              </Button>
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
