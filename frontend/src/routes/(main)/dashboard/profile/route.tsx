import { type FormEvent, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Save, ShieldCheck } from "lucide-react";

import { AsyncButton } from "@/components/ui/async-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { useAuthImage } from "@/framework/use-auth-image";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { getInitials } from "@/lib/utils";

export const Route = createFileRoute("/(main)/dashboard/profile")({
  component: PersonalProfilePage,
});

interface ProfileData {
  id?: string;
  username?: string;
  role?: string;
  display_name?: string;
  email?: string;
  bio?: string;
  avatar_url?: string;
}

/**
 * Dedicated Personal Profile View/Edit ONLY (F16).
 * Security/2FA/Passkeys, Sessions, and Login History live on their own dedicated pages.
 */
function PersonalProfilePage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarSrc = useAuthImage(avatarUrl);

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiRequest<{ avatar_url?: string }>("/profile/avatar", { method: "POST", body: fd });
      setAvatarUrl(res.avatar_url || "");
      notify.success(t.common.savedSuccess);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleAvatarRemove() {
    setUploading(true);
    try {
      await apiRequest("/profile/avatar", { method: "DELETE" });
      setAvatarUrl("");
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    apiRequest<ProfileData>("/profile/me")
      .then((res) => {
        setProfile(res);
        setDisplayName(res.display_name || "");
        setEmail(res.email || "");
        setBio(res.bio || "");
        setAvatarUrl(res.avatar_url || "");
      })
      .catch((err) => notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [t.common.errorTitle]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await apiRequest<ProfileData>("/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim(),
          bio: bio.trim(),
        }),
      });
      setProfile(updated);
      notify.success(t.common.savedSuccess);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <TerminalPageShell
      title={t.profile.title}
      subtitle={t.profile.subtitle}
      badge={profile?.role || "OPERATOR"}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/dashboard/security" />}>
          <ShieldCheck className="mr-1.5 size-3.5" />
          {t.nav.security}
        </Button>
      }
    >
      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center gap-4 border-b border-border/60 pb-4">
            <Avatar className="size-14 rounded-xl ring-1 ring-border">
              <AvatarImage src={avatarSrc} alt={displayName || profile?.username || "User"} />
              <AvatarFallback className="text-base font-semibold">
                {getInitials(displayName || profile?.username || "U")}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{displayName || profile?.username}</span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {profile?.role || "ADMIN"}
                </Badge>
              </div>
              <div className="text-muted-foreground font-mono text-xs">@{profile?.username}</div>
            </div>
          </div>

          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prof-display">{t.auth.displayName}</Label>
                <Input id="prof-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-email">{t.auth.email}</Label>
                <Input id="prof-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prof-avatar">{t.profile.avatarUrl}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="prof-avatar"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  disabled={uploading}
                  onChange={(e) => {
                    void handleAvatarFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {avatarUrl ? (
                  <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => void handleAvatarRemove()}>
                    {t.common.delete ?? "Delete"}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prof-bio">{t.profile.bio}</Label>
              <Textarea id="prof-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <AsyncButton type="submit" loading={saving} loadingText={t.common.saving}>
                <Save className="mr-1.5 size-4" />
                {t.profile.saveProfile}
              </AsyncButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
