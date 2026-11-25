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

export const Route = createFileRoute("/(main)/dashboard/users/new")({
  component: UserCreatePage,
});

function UserCreatePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "OPERATOR" | "VIEWER">("OPERATOR");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await apiRequest<{ id: string }>("/users", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          display_name: displayName.trim() || username.trim(),
          password,
          role,
        }),
      });
      notify.success(t.common.createdSuccess, username.trim());
      await navigate({ to: "/dashboard/users/$userId", params: { userId: created.id } });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalPageShell
      title={t.users.newTitle}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/users" />}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          {t.common.backToList}
        </Button>
      }
    >
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="u-username">{t.auth.username}</Label>
              <Input id="u-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-display">{t.auth.displayName}</Label>
              <Input id="u-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">{t.auth.email}</Label>
              <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-password">{t.auth.password}</Label>
              <Input id="u-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">{t.users.role}</Label>
              <select
                id="u-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "OPERATOR" | "VIEWER")}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="OPERATOR">OPERATOR</option>
                <option value="VIEWER">VIEWER</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" nativeButton={false} render={<Link to="/dashboard/users" />}>
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
