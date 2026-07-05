import { useEffect, useState } from "react";
import { LogOutIcon } from "lucide-react";
import {
  changePasswordAuth,
  fetchProfile,
  fetchTenantMembers,
  logoutAuth,
  updateProfile,
  type UserProfile,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ProfileFormField =
  | "displayName"
  | "headline"
  | "bio"
  | "phone"
  | "location"
  | "timezone"
  | "website"
  | "twitter"
  | "github"
  | "linkedin"
  | "company"
  | "jobTitle"
  | "avatarUrl"
  | "birthday"
  | "languages"
  | "interests"
  | "values"
  | "goals"
  | "personalityNotes"
  | "decisionStyle"
  | "riskTolerance";

type ProfileForm = Record<ProfileFormField, string>;

const EMPTY_PROFILE_FORM: ProfileForm = {
  displayName: "",
  headline: "",
  bio: "",
  phone: "",
  location: "",
  timezone: "",
  website: "",
  twitter: "",
  github: "",
  linkedin: "",
  company: "",
  jobTitle: "",
  avatarUrl: "",
  birthday: "",
  languages: "",
  interests: "",
  values: "",
  goals: "",
  personalityNotes: "",
  decisionStyle: "",
  riskTolerance: "",
};

function profileToForm(profile: UserProfile): ProfileForm {
  return {
    displayName: profile.displayName ?? "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    timezone: profile.timezone ?? "",
    website: profile.website ?? "",
    twitter: profile.twitter ?? "",
    github: profile.github ?? "",
    linkedin: profile.linkedin ?? "",
    company: profile.company ?? "",
    jobTitle: profile.jobTitle ?? "",
    avatarUrl: profile.avatarUrl ?? "",
    birthday: profile.birthday ?? "",
    languages: profile.languages ?? "",
    interests: profile.interests ?? "",
    values: profile.values ?? "",
    goals: profile.goals ?? "",
    personalityNotes: profile.personalityNotes ?? "",
    decisionStyle: profile.decisionStyle ?? "",
    riskTolerance: profile.riskTolerance ?? "",
  };
}

/**
 * The signed-in user's own profile, account security, and projects. Rendered
 * both as the standalone Profile page and inside the "you" node of the Users
 * relationship chart.
 */
export function UserProfilePanel() {
  const { user, tenants, activeTenantId, refresh } = useTenant();
  const [members, setMembers] = useState<
    Array<{ id: string; email: string; displayName: string; role: string }>
  >([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [savingProfile, setSavingProfile] = useState(false);

  const isAdmin = Boolean(user?.isAdmin);
  const activeProject = tenants.find((t) => t.id === activeTenantId) ?? null;
  const initial =
    (profileForm.displayName || user?.displayName)?.trim()?.[0]?.toUpperCase() ??
    "?";

  useEffect(() => {
    if (!activeTenantId) return;
    fetchTenantMembers(activeTenantId)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [activeTenantId]);

  useEffect(() => {
    fetchProfile()
      .then((r) => {
        setProfile(r.profile);
        setProfileForm(profileToForm(r.profile));
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const setField = (field: ProfileFormField, value: string) =>
    setProfileForm((prev) => ({ ...prev, [field]: value }));

  const signOut = async () => {
    try {
      await logoutAuth();
    } catch {
      /* still clear local session below */
    }
    await refresh();
    window.location.assign("/");
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const r = await updateProfile({
        displayName: profileForm.displayName.trim(),
        avatarUrl: profileForm.avatarUrl,
        headline: profileForm.headline,
        bio: profileForm.bio,
        phone: profileForm.phone,
        location: profileForm.location,
        timezone: profileForm.timezone,
        website: profileForm.website,
        twitter: profileForm.twitter,
        github: profileForm.github,
        linkedin: profileForm.linkedin,
        company: profileForm.company,
        jobTitle: profileForm.jobTitle,
        birthday: profileForm.birthday,
        languages: profileForm.languages,
        interests: profileForm.interests,
        values: profileForm.values,
        goals: profileForm.goals,
        personalityNotes: profileForm.personalityNotes,
        decisionStyle: profileForm.decisionStyle,
        riskTolerance: profileForm.riskTolerance,
      });
      setProfile(r.profile);
      setProfileForm(profileToForm(r.profile));
      toast.success("Profile saved");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setChangingPassword(true);
    try {
      await changePasswordAuth(currentPassword, newPassword);
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="projects">Projects</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="mt-4 flex flex-col gap-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                How other users and agents identify you on the platform.
              </CardDescription>
            </div>
            <Button
              className="w-fit"
              disabled={savingProfile || !profileForm.displayName.trim()}
              onClick={() => void handleSaveProfile()}
            >
              {savingProfile ? "Saving…" : "Save changes"}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {profileForm.avatarUrl ? (
                <img
                  src={profileForm.avatarUrl}
                  alt={profileForm.displayName || "Avatar"}
                  className="size-16 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold">
                  {initial}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium">
                    {profileForm.displayName || "—"}
                  </span>
                  {isAdmin && <Badge variant="secondary">Platform admin</Badge>}
                </div>
                {profileForm.headline && (
                  <div className="text-sm text-muted-foreground">
                    {profileForm.headline}
                  </div>
                )}
                {activeProject && (
                  <div className="text-sm text-muted-foreground">
                    Active project:{" "}
                    <span className="font-medium text-foreground">
                      {activeProject.name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Basics</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-display-name">Display name</Label>
                  <Input
                    id="profile-display-name"
                    value={profileForm.displayName}
                    onChange={(e) => setField("displayName", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-headline">Headline</Label>
                  <Input
                    id="profile-headline"
                    placeholder="Quant trader & systems builder"
                    value={profileForm.headline}
                    onChange={(e) => setField("headline", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-avatar">Avatar URL</Label>
                  <Input
                    id="profile-avatar"
                    placeholder="https://…"
                    value={profileForm.avatarUrl}
                    onChange={(e) => setField("avatarUrl", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-bio">Bio</Label>
                <Textarea
                  id="profile-bio"
                  rows={4}
                  placeholder="Tell other people and agents about yourself."
                  value={profileForm.bio}
                  onChange={(e) => setField("bio", e.target.value)}
                />
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Work</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input
                    id="profile-email"
                    value={profile?.email ?? user?.email ?? ""}
                    disabled
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-phone">Phone</Label>
                  <Input
                    id="profile-phone"
                    value={profileForm.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-location">Location</Label>
                  <Input
                    id="profile-location"
                    placeholder="City, Country"
                    value={profileForm.location}
                    onChange={(e) => setField("location", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-timezone">Timezone</Label>
                  <Input
                    id="profile-timezone"
                    placeholder="America/Denver"
                    value={profileForm.timezone}
                    onChange={(e) => setField("timezone", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-company">Company</Label>
                  <Input
                    id="profile-company"
                    value={profileForm.company}
                    onChange={(e) => setField("company", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-job-title">Job title</Label>
                  <Input
                    id="profile-job-title"
                    value={profileForm.jobTitle}
                    onChange={(e) => setField("jobTitle", e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Social</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-website">Website</Label>
                  <Input
                    id="profile-website"
                    placeholder="https://…"
                    value={profileForm.website}
                    onChange={(e) => setField("website", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-twitter">Twitter / X</Label>
                  <Input
                    id="profile-twitter"
                    placeholder="@handle"
                    value={profileForm.twitter}
                    onChange={(e) => setField("twitter", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-github">GitHub</Label>
                  <Input
                    id="profile-github"
                    placeholder="username"
                    value={profileForm.github}
                    onChange={(e) => setField("github", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-linkedin">LinkedIn</Label>
                  <Input
                    id="profile-linkedin"
                    placeholder="in/username"
                    value={profileForm.linkedin}
                    onChange={(e) => setField("linkedin", e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">About you</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-birthday">Birthday</Label>
                  <Input
                    id="profile-birthday"
                    placeholder="1990-01-15"
                    value={profileForm.birthday}
                    onChange={(e) => setField("birthday", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-languages">Languages</Label>
                  <Input
                    id="profile-languages"
                    placeholder="English, Spanish"
                    value={profileForm.languages}
                    onChange={(e) => setField("languages", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-interests">Interests</Label>
                <Textarea
                  id="profile-interests"
                  rows={2}
                  placeholder="Markets, climbing, coffee…"
                  value={profileForm.interests}
                  onChange={(e) => setField("interests", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-values">Values</Label>
                <Textarea
                  id="profile-values"
                  rows={2}
                  placeholder="What matters most to you?"
                  value={profileForm.values}
                  onChange={(e) => setField("values", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-goals">Goals</Label>
                <Textarea
                  id="profile-goals"
                  rows={2}
                  placeholder="Short- and long-term goals"
                  value={profileForm.goals}
                  onChange={(e) => setField("goals", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-personality">Personality notes</Label>
                <Textarea
                  id="profile-personality"
                  rows={3}
                  placeholder="How you think, communicate, and show up"
                  value={profileForm.personalityNotes}
                  onChange={(e) => setField("personalityNotes", e.target.value)}
                />
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Preferences</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-decision-style">Decision style</Label>
                  <Input
                    id="profile-decision-style"
                    placeholder="Data-first, intuitive, collaborative…"
                    value={profileForm.decisionStyle}
                    onChange={(e) => setField("decisionStyle", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-risk-tolerance">Risk tolerance</Label>
                  <Input
                    id="profile-risk-tolerance"
                    placeholder="Conservative, balanced, aggressive…"
                    value={profileForm.riskTolerance}
                    onChange={(e) => setField("riskTolerance", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="account" className="mt-4 flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Update the password you use to sign in with email.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex max-w-md flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button
              className="w-fit"
              disabled={changingPassword || !currentPassword || !newPassword}
              onClick={() => void handleChangePassword()}
            >
              Update password
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOutIcon data-icon="inline-start" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="projects" className="mt-4 flex flex-col gap-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Your projects</CardTitle>
              <CardDescription>
                Projects you own or collaborate in. The active project drives
                which agents and data you see.
              </CardDescription>
            </div>
            <CreateWorkspaceDialog />
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="capitalize">{t.role}</TableCell>
                      <TableCell>
                        {t.is_operator === 1 ? (
                          <Badge variant="outline">Operator</Badge>
                        ) : (
                          <span className="text-muted-foreground">Project</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {activeProject && (
          <Card>
            <CardHeader>
              <CardTitle>Project members</CardTitle>
              <CardDescription>
                People with access to {activeProject.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">
                          {m.displayName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.email}
                        </TableCell>
                        <TableCell className="capitalize">{m.role}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}
