import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { SearchSelect } from "@/components/ui/search-select";

export const Route = createFileRoute("/(main)/dashboard/users/$userId/edit")({
  component: UserEditPage,
});

function UserEditPage() {
  const { userId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "OPERATOR" | "VIEWER">("OPERATOR");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ display_name?: string; email?: string; role?: string; is_active?: boolean }>(
      `/users/${encodeURIComponent(userId)}`,
    )
      .then((res) => {
        setDisplayName(res.display_name || "");
        setEmail(res.email || "");
        setRole((res.role as "ADMIN" | "OPERATOR" | "VIEWER") || "OPERATOR");
        setIsActive(res.is_active !== false);
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [userId, t.common.errorTitle]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        display_name: displayName.trim(),
        email: email.trim(),
        role,
        is_active: isActive,
      };
      if (password.trim()) {
        payload.password = password;
      }
      await apiRequest(`/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      notify.success(t.common.savedSuccess);
      await navigate({ to: "/dashboard/users/$userId", params: { userId } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.users.editTitle}
      subtitle={userId}
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/dashboard/users/$userId" params={{ userId }} />}
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
              <Label htmlFor="ue-display">{t.auth.displayName}</Label>
              <Input id="ue-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ue-email">{t.auth.email}</Label>
              <Input id="ue-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ue-role">{t.users.role}</Label>
              <SearchSelect
                id="ue-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "OPERATOR" | "VIEWER")}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="OPERATOR">OPERATOR</option>
                <option value="VIEWER">VIEWER</option>
              </SearchSelect>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ue-active" checked={isActive} onCheckedChange={(v) => setIsActive(Boolean(v))} />
              <Label htmlFor="ue-active">{t.users.activeStatus}</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ue-password">{t.users.newPasswordOptional}</Label>
              <Input id="ue-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link to="/dashboard/users/$userId" params={{ userId }} />}
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
