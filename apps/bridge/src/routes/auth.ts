import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import {
  getCoreDb,
  type CoreUser,
  type CoreUserProfile,
} from "../core-db.js";
import { coreUserToAuth } from "../types/express-auth.js";
import {
  clearLegacySessionCookie,
  clearSessionCookie,
  createSession,
  deleteSession,
  issueSessionCookies,
  parseSessionCookie,
  slugFromEmail,
} from "../services/auth/session-store.js";
import { hashPassword, verifyPassword } from "../services/auth/password.js";
import {
  attachAuthContext,
  getOperatorTenantIdCached,
  requireAuth,
  requirePlatformAdmin,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  createTenantForUser,
  listUserTenants,
  promoteFirstSignupAdmin,
  userHasTenantAccess,
} from "../services/tenant-bootstrap.js";
import { refreshUserAgentPrompt } from "../services/agents/user-agent.js";
import { getUserOwnerTenantDb } from "../services/user-scope.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import { seedPersonalOsForNewTenant } from "../services/personal-os-seed.js";
import { getTenantDb } from "../tenant-registry.js";

export function createAuthRouter(): Router {
  const router = Router();
  const secure = config.auth.publicUrl.startsWith("https");
  const authLimiter = rateLimit({ windowMs: 60_000, max: 20, message: "Too many auth attempts" });

  router.get("/me", attachAuthContext, requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.get("/tenants", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const tenants = listUserTenants(core, req.user!.id);
    res.json({ tenants, operatorTenantId: getOperatorTenantIdCached() });
  });

  router.post("/tenants", attachAuthContext, requireAuth, (req, res) => {
    if (config.isClient) {
      res.status(403).json({ error: "Additional workspaces are disabled in client mode" });
      return;
    }
    const { name, slug } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const tenantSlug =
      typeof slug === "string" && slug.trim()
        ? slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
        : slugFromEmail(req.user!.email);
    const core = getCoreDb();
    const existing = core
      .prepare("SELECT id FROM tenants WHERE slug=?")
      .get(tenantSlug);
    if (existing) {
      res.status(409).json({ error: "slug taken" });
      return;
    }
    const tenantId = createTenantForUser(
      core,
      req.user!.id,
      name.trim(),
      tenantSlug
    );
    seedPersonalOsForNewTenant(getTenantDb(tenantId));
    res.status(201).json({ id: tenantId, slug: tenantSlug });
  });

  router.post("/login", authLimiter, (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    const core = getCoreDb();
    const user = core
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.trim().toLowerCase()) as CoreUser | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const sessionId = createSession(core, user.id, config.auth.sessionTtlDays);
    res.setHeader(
      "Set-Cookie",
      issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
    );

    res.json({
      user: coreUserToAuth(user),
      ...(config.isProduction ? {} : { sessionToken: sessionId }),
    });
  });

  router.post("/signup", authLimiter, (req, res) => {
    if (!config.auth.allowSignup) {
      res.status(403).json({ error: "Signup is disabled; request an invite or contact the admin" });
      return;
    }
    const { email, password, name, inviteCode } = req.body ?? {};
    if (config.auth.inviteCodes.length > 0) {
      const code = typeof inviteCode === "string" ? inviteCode.trim() : "";
      if (!code || !config.auth.inviteCodes.includes(code)) {
        res.status(403).json({ error: "Valid invite code required" });
        return;
      }
    }
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const displayName =
      typeof name === "string" && name.trim() ? name.trim() : normalized.split("@")[0];

    const core = getCoreDb();
    const existing = core
      .prepare("SELECT id FROM users WHERE email=?")
      .get(normalized) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const id = uuidv4();
    core.prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, is_admin, password_hash)
       VALUES (?, ?, ?, NULL, 0, ?)`
    ).run(id, normalized, displayName, hashPassword(password));

    const tenantId = createTenantForUser(core, id, `${displayName}'s Project`, slugFromEmail(normalized));
    seedPersonalOsForNewTenant(getTenantDb(tenantId));
    promoteFirstSignupAdmin(core, id);

    const user = core.prepare("SELECT * FROM users WHERE id=?").get(id) as CoreUser;
    const sessionId = createSession(core, id, config.auth.sessionTtlDays);
    res.setHeader(
      "Set-Cookie",
      issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
    );
    res.status(201).json({
      user: coreUserToAuth(user),
      ...(config.isProduction ? {} : { sessionToken: sessionId }),
    });
  });

  router.post("/logout", attachAuthContext, (req, res) => {
    const core = getCoreDb();
    const sessionId = req.sessionId ?? parseSessionCookie(req.headers.cookie);
    if (sessionId) deleteSession(core, sessionId);
    res.setHeader("Set-Cookie", [
      clearSessionCookie(secure),
      clearLegacySessionCookie(secure),
    ]);
    res.json({ ok: true });
  });

  router.post("/change-password", attachAuthContext, requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword ||
      newPassword.length < 6
    ) {
      res.status(400).json({ error: "currentPassword and newPassword (min 6 chars) required" });
      return;
    }
    const core = getCoreDb();
    const user = core
      .prepare("SELECT * FROM users WHERE id=?")
      .get(req.user!.id) as CoreUser | undefined;
    if (!user?.password_hash || !verifyPassword(currentPassword, user.password_hash)) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    core.prepare(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
    ).run(hashPassword(newPassword), user.id);
    res.json({ ok: true });
  });

  router.get("/profile", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const user = core
      .prepare("SELECT * FROM users WHERE id=?")
      .get(req.user!.id) as CoreUser | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const profile = core
      .prepare("SELECT * FROM user_profiles WHERE user_id=?")
      .get(req.user!.id) as CoreUserProfile | undefined;
    res.json({ profile: mergeProfile(user, profile) });
  });

  router.patch("/profile", attachAuthContext, requireAuth, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null => {
      if (v == null) return null;
      const trimmed = String(v).trim();
      return trimmed ? trimmed : null;
    };

    const core = getCoreDb();
    const userId = req.user!.id;

    if (typeof body.displayName === "string") {
      const displayName = body.displayName.trim();
      if (!displayName) {
        res.status(400).json({ error: "displayName cannot be empty" });
        return;
      }
      core.prepare(
        `UPDATE users SET display_name=?, updated_at=datetime('now') WHERE id=?`
      ).run(displayName, userId);
    }
    if ("avatarUrl" in body) {
      core.prepare(
        `UPDATE users SET avatar_url=?, updated_at=datetime('now') WHERE id=?`
      ).run(str(body.avatarUrl), userId);
    }

    core.prepare(
      `INSERT INTO user_profiles (user_id) VALUES (?)
       ON CONFLICT(user_id) DO NOTHING`
    ).run(userId);

    const fieldMap: Record<string, string> = {
      headline: "headline",
      bio: "bio",
      pronouns: "pronouns",
      location: "location",
      timezone: "timezone",
      phone: "phone",
      company: "company",
      jobTitle: "job_title",
      website: "website",
      twitter: "twitter",
      github: "github",
      linkedin: "linkedin",
      emoji: "emoji",
      birthday: "birthday",
      languages: "languages",
      interests: "interests",
      values: "values",
      goals: "goals",
      personalityNotes: "personality_notes",
      decisionStyle: "decision_style",
      riskTolerance: "risk_tolerance",
    };
    const sets: string[] = [];
    const values: Array<string | null> = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in body) {
        sets.push(`"${column}"=?`);
        values.push(str(body[key]));
      }
    }
    if (sets.length > 0) {
      values.push(userId);
      core.prepare(
        `UPDATE user_profiles SET ${sets.join(", ")}, updated_at=datetime('now') WHERE user_id=?`
      ).run(...values);
    }

    const user = core
      .prepare("SELECT * FROM users WHERE id=?")
      .get(userId) as CoreUser;
    const profile = core
      .prepare("SELECT * FROM user_profiles WHERE user_id=?")
      .get(userId) as CoreUserProfile | undefined;
    try {
      refreshUserAgentPrompt(getUserOwnerTenantDb(userId), userId);
    } catch {
      /* tenant may not exist yet */
    }
    res.json({ profile: mergeProfile(user, profile) });
  });

  router.get(
    "/users/lookup",
    attachAuthContext,
    requireAuth,
    (req, res) => {
      const email =
        typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
      if (!email) {
        res.status(400).json({ error: "email required" });
        return;
      }
      const row = getCoreDb()
        .prepare(
          `SELECT id, email, display_name, avatar_url, is_admin
           FROM users WHERE email=? AND id <> 'system-local'`
        )
        .get(email) as
        | {
            id: string;
            email: string;
            display_name: string;
            avatar_url: string | null;
            is_admin: number;
          }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({
        user: {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          isAdmin: Boolean(row.is_admin),
        },
      });
    }
  );

  router.get(
    "/tenants/:tenantId/members",
    attachAuthContext,
    requireAuth,
    (req, res) => {
      const core = getCoreDb();
      const tenantId = String(req.params.tenantId);
      const role = userHasTenantAccess(core, req.user!.id, tenantId);
      if (!role) {
        res.status(403).json({ error: "No access to this workspace" });
        return;
      }
      const members = core
        .prepare(
          `SELECT u.id, u.email, u.display_name, u.avatar_url, m.role
           FROM tenant_memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id=?
           ORDER BY m.role DESC, u.display_name`
        )
        .all(tenantId) as Array<{
        id: string;
        email: string;
        display_name: string;
        avatar_url: string | null;
        role: string;
      }>;
      res.json({
        members: members.map((m) => ({
          id: m.id,
          email: m.email,
          displayName: m.display_name,
          avatarUrl: m.avatar_url,
          role: m.role,
        })),
      });
    }
  );

  router.get(
    "/users",
    attachAuthContext,
    requireAuth,
    requirePlatformAdmin,
    (_req, res) => {
      const core = getCoreDb();
      const rows = core
        .prepare(
          `SELECT id, email, display_name, avatar_url, is_admin, created_at
           FROM users
           WHERE id <> 'system-local'
           ORDER BY is_admin DESC, created_at`
        )
        .all() as Array<{
        id: string;
        email: string;
        display_name: string;
        avatar_url: string | null;
        is_admin: number;
        created_at: string;
      }>;

      const users = rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        isAdmin: Boolean(u.is_admin),
        createdAt: u.created_at,
        tenants: listUserTenants(core, u.id),
      }));
      res.json({ users });
    }
  );

  router.get("/session", attachAuthContext, (req, res) => {
    if (!req.user) {
      res.json({ authenticated: false });
      return;
    }
    resolveTenant(req, res, () => {
      res.json({
        authenticated: true,
        user: req.user,
        tenantId: req.tenantId,
        tenantRole: req.tenantRole,
      });
    });
  });

  return router;
}

function mergeProfile(
  user: CoreUser,
  profile: CoreUserProfile | undefined
): {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  pronouns: string | null;
  location: string | null;
  timezone: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  website: string | null;
  twitter: string | null;
  github: string | null;
  linkedin: string | null;
  emoji: string | null;
  birthday: string | null;
  languages: string | null;
  interests: string | null;
  values: string | null;
  goals: string | null;
  personalityNotes: string | null;
  decisionStyle: string | null;
  riskTolerance: string | null;
} {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    headline: profile?.headline ?? null,
    bio: profile?.bio ?? null,
    pronouns: profile?.pronouns ?? null,
    location: profile?.location ?? null,
    timezone: profile?.timezone ?? null,
    phone: profile?.phone ?? null,
    company: profile?.company ?? null,
    jobTitle: profile?.job_title ?? null,
    website: profile?.website ?? null,
    twitter: profile?.twitter ?? null,
    github: profile?.github ?? null,
    linkedin: profile?.linkedin ?? null,
    emoji: profile?.emoji ?? null,
    birthday: profile?.birthday ?? null,
    languages: profile?.languages ?? null,
    interests: profile?.interests ?? null,
    values: profile?.values ?? null,
    goals: profile?.goals ?? null,
    personalityNotes: profile?.personality_notes ?? null,
    decisionStyle: profile?.decision_style ?? null,
    riskTolerance: profile?.risk_tolerance ?? null,
  };
}
