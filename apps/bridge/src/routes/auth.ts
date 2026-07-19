import { randomBytes } from "node:crypto";
import { Router } from "express";
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
} from "../services/auth/session-store.js";
import { verifyPassword } from "../services/auth/password.js";
import {
  attachAuthContext,
  getOperatorTenantIdCached,
  requireAuth,
  requirePlatformAdmin,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  listUserTenants,
  userHasTenantAccess,
} from "../services/tenant-bootstrap.js";
import { refreshUserAgentPrompt } from "../services/agents/user-agent.js";
import { getUserOwnerTenantDb } from "../services/user-scope.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  createSystemOperationContext,
  executeCollectionAction,
  executeRecordAction,
  KernelError,
} from "../kernel/record-api.js";
import {
  beginMfaEnroll,
  confirmMfaEnroll,
  consumeAuthToken,
  disableMfa,
  issueAuthToken,
  mfaEnabled,
  verifyMfaChallenge,
} from "../services/auth/mfa-and-tokens.js";
import {
  resetPasswordEmail,
  sendMail,
  verificationEmail,
} from "../services/auth/mailer.js";
import { hashPassword } from "../services/auth/password.js";
import {
  consumeSaasEntitlement,
  findPendingEntitlementByStripeSession,
} from "../services/saas-entitlements.js";
import {
  resolveEntitlementForCheckoutSession,
} from "../services/saas-billing.js";
import {
  assertSaasUserMayAccess,
  linkSubscriptionToUser,
  touchUserLastSeen,
} from "../services/saas-subscriptions.js";

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

    const access = assertSaasUserMayAccess(user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const coreDb = core;
    if (mfaEnabled(coreDb, user.id)) {
      const mfaToken = issueAuthToken(coreDb, {
        userId: user.id,
        purpose: "mfa_login",
        ttlMinutes: 5,
      });
      res.json({
        mfaRequired: true,
        mfaToken,
        user: coreUserToAuth(user, { mfaEnabled: true }),
      });
      return;
    }

    touchUserLastSeen(user.id);
    const sessionId = createSession(core, user.id, config.auth.sessionTtlDays);
    res.setHeader(
      "Set-Cookie",
      issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
    );

    res.json({
      user: coreUserToAuth(user, { mfaEnabled: false }),
      mfaSetupRequired: Boolean(config.isSaas && user.is_admin),
      ...(config.isProduction ? {} : { sessionToken: sessionId }),
    });
  });

  router.post("/signup", authLimiter, async (req, res) => {
    const { email, password, name, inviteCode, checkoutSessionId } = req.body ?? {};
    const code = typeof inviteCode === "string" ? inviteCode.trim() : "";
    const paidSessionId =
      typeof checkoutSessionId === "string" ? checkoutSessionId.trim() : "";

    if (config.isSaas) {
      if (!paidSessionId) {
        res.status(403).json({
          error: "Choose a plan and complete payment before signing up",
        });
        return;
      }
      try {
        const entitlement = await resolveEntitlementForCheckoutSession(paidSessionId);
        if (!entitlement || entitlement.status !== "pending") {
          res.status(403).json({
            error: "Payment required or already used — complete checkout, then sign up",
          });
          return;
        }
      } catch {
        res.status(403).json({ error: "Could not verify payment" });
        return;
      }
    } else if (!config.auth.allowSignup) {
      res.status(403).json({ error: "Signup is disabled; request an invite or contact the admin" });
      return;
    } else if (config.auth.inviteCodes.length > 0) {
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
    if (config.isSaas && paidSessionId) {
      const entitlement = findPendingEntitlementByStripeSession(core, paidSessionId);
      if (entitlement?.email && entitlement.email !== normalized) {
        res.status(403).json({
          error: `This payment is for ${entitlement.email}. Sign up with that email.`,
        });
        return;
      }
    }

    const existing = core
      .prepare("SELECT id FROM users WHERE email=?")
      .get(normalized) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    try {
      const created = await executeCollectionAction(
        core,
        "User",
        "signup",
        {
          email: normalized,
          password,
          display_name: displayName,
        },
        createSystemOperationContext({
          requestId: req.get("X-Request-Id") || undefined,
        })
      ) as { id: string };
      if (config.isSaas && paidSessionId) {
        const entitlement = consumeSaasEntitlement(core, paidSessionId, created.id);
        linkSubscriptionToUser({
          userId: created.id,
          stripeSessionId: paidSessionId,
          stripeCustomerId: entitlement.stripe_customer_id,
          email: normalized,
        });
      }
      const user = core.prepare("SELECT * FROM users WHERE id=?").get(created.id) as CoreUser;
      // Seeded INITIAL_ADMINS may already be verified; otherwise send verify link.
      if (!user.email_verified_at) {
        try {
          const token = issueAuthToken(core, {
            userId: user.id,
            purpose: "verify",
            ttlMinutes: 60 * 24,
          });
          const link = `${config.web.publicUrl.replace(/\/$/, "")}/login?verify=${encodeURIComponent(token)}`;
          void sendMail(verificationEmail({ to: normalized, link })).catch((err) =>
            console.error("[auth] signup verification mail failed", err)
          );
        } catch (err) {
          console.error("[auth] signup verification token failed", err);
        }
      }
      const sessionId = createSession(core, user.id, config.auth.sessionTtlDays);
      res.setHeader(
        "Set-Cookie",
        issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
      );
      res.status(201).json({
        user: coreUserToAuth(user, { mfaEnabled: false }),
        ...(config.isProduction ? {} : { sessionToken: sessionId }),
      });
    } catch (err) {
      if (err instanceof KernelError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err && typeof err === "object" && "status" in err) {
        res.status(Number((err as { status: number }).status) || 403).json({
          error: err instanceof Error ? err.message : "Signup failed",
        });
        return;
      }
      throw err;
    }
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

  router.post("/change-password", attachAuthContext, requireAuth, async (req, res) => {
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
    try {
      await executeRecordAction(
        getCoreDb(),
        "UserCredential",
        req.user!.id,
        "change_password",
        {
          current_password: currentPassword,
          new_password: newPassword,
        },
        {
          userId: req.user!.id,
          isAdmin: req.user!.isAdmin,
          role: "editor",
          source: "http",
        }
      );
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof KernelError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
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

  router.post("/mfa/verify-login", authLimiter, (req, res) => {
    const { mfaToken, code } = req.body ?? {};
    if (typeof mfaToken !== "string" || typeof code !== "string") {
      res.status(400).json({ error: "mfaToken and code required" });
      return;
    }
    const core = getCoreDb();
    const consumed = consumeAuthToken(core, { rawToken: mfaToken, purpose: "mfa_login" });
    if (!consumed) {
      res.status(401).json({ error: "Invalid or expired MFA token" });
      return;
    }
    if (!verifyMfaChallenge(core, consumed.userId, code)) {
      res.status(401).json({ error: "Invalid MFA code" });
      return;
    }
    const user = core.prepare("SELECT * FROM users WHERE id=?").get(consumed.userId) as CoreUser;
    touchUserLastSeen(user.id);
    const sessionId = createSession(core, user.id, config.auth.sessionTtlDays);
    res.setHeader(
      "Set-Cookie",
      issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
    );
    res.json({
      user: coreUserToAuth(user, { mfaEnabled: true }),
      ...(config.isProduction ? {} : { sessionToken: sessionId }),
    });
  });

  router.post("/request-verification", authLimiter, async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    // Always OK — do not reveal account existence
    res.json({ ok: true });
    if (!email) return;
    try {
      const core = getCoreDb();
      const user = core.prepare("SELECT * FROM users WHERE email=?").get(email) as
        | CoreUser
        | undefined;
      if (!user || user.email_verified_at) return;
      const token = issueAuthToken(core, {
        userId: user.id,
        purpose: "verify",
        ttlMinutes: 60 * 24,
      });
      const link = `${config.web.publicUrl.replace(/\/$/, "")}/login?verify=${encodeURIComponent(token)}`;
      await sendMail(verificationEmail({ to: email, link }));
    } catch (err) {
      console.error("[auth] verification mail failed", err);
    }
  });

  router.post("/verify-email", authLimiter, (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    const core = getCoreDb();
    const consumed = consumeAuthToken(core, { rawToken: token, purpose: "verify" });
    if (!consumed) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }
    core
      .prepare(
        `UPDATE users SET email_verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
      )
      .run(consumed.userId);
    res.json({ ok: true });
  });

  router.post("/forgot-password", authLimiter, async (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    res.json({ ok: true });
    if (!email) return;
    try {
      const core = getCoreDb();
      const user = core.prepare("SELECT * FROM users WHERE email=?").get(email) as
        | CoreUser
        | undefined;
      if (!user) return;
      const token = issueAuthToken(core, {
        userId: user.id,
        purpose: "reset",
        ttlMinutes: 60,
      });
      const link = `${config.web.publicUrl.replace(/\/$/, "")}/login?reset=${encodeURIComponent(token)}`;
      await sendMail(resetPasswordEmail({ to: email, link }));
    } catch (err) {
      console.error("[auth] reset mail failed", err);
    }
  });

  router.post("/reset-password", authLimiter, (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!token || newPassword.length < 6) {
      res.status(400).json({ error: "token and newPassword (min 6) required" });
      return;
    }
    const core = getCoreDb();
    const consumed = consumeAuthToken(core, { rawToken: token, purpose: "reset" });
    if (!consumed) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }
    core
      .prepare(
        `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
      )
      .run(hashPassword(newPassword), consumed.userId);
    res.json({ ok: true });
  });

  router.post("/mfa/begin", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const result = beginMfaEnroll(core, req.user!.id, req.user!.email);
    res.json(result);
  });

  router.post("/mfa/confirm", attachAuthContext, requireAuth, (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const core = getCoreDb();
    if (!confirmMfaEnroll(core, req.user!.id, code)) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/mfa/disable", attachAuthContext, requireAuth, (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const core = getCoreDb();
    if (!verifyMfaChallenge(core, req.user!.id, code)) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }
    disableMfa(core, req.user!.id);
    res.json({ ok: true });
  });

  router.get("/mfa/status", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    res.json({
      enabled: mfaEnabled(core, req.user!.id),
      required: Boolean(config.isSaas && req.user!.isAdmin),
    });
  });

  router.get("/oauth/providers", (_req, res) => {
    res.json({
      google: Boolean(config.oauth.google.clientId),
      github: Boolean(config.oauth.github.clientId),
    });
  });

  // OAuth: Google + GitHub
  router.get("/oauth/:provider/start", authLimiter, (req, res) => {
    const provider = String(req.params.provider);
    const redirectUri = `${config.auth.publicUrl.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
    if (provider === "google") {
      const { clientId } = config.oauth.google;
      if (!clientId) {
        res.status(503).json({ error: "Google OAuth not configured" });
        return;
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("access_type", "online");
      res.json({ url: url.toString() });
      return;
    }
    if (provider === "github") {
      const { clientId } = config.oauth.github;
      if (!clientId) {
        res.status(503).json({ error: "GitHub OAuth not configured" });
        return;
      }
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "read:user user:email");
      res.json({ url: url.toString() });
      return;
    }
    res.status(404).json({ error: "Unknown provider" });
  });

  router.get("/oauth/:provider/callback", authLimiter, async (req, res) => {
    const provider = String(req.params.provider);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.status(400).send("Missing code");
      return;
    }
    try {
      const profile = await exchangeOauthCode(provider, code);
      const core = getCoreDb();
      let userId: string | undefined;
      const linked = core
        .prepare(
          `SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_user_id=?`
        )
        .get(provider, profile.providerUserId) as { user_id: string } | undefined;
      if (linked) {
        userId = linked.user_id;
      } else {
        const existing = core
          .prepare(`SELECT id FROM users WHERE email=?`)
          .get(profile.email) as { id: string } | undefined;
        if (existing) {
          userId = existing.id;
        } else {
          const created = await executeCollectionAction(
            core,
            "User",
            "signup",
            {
              email: profile.email,
              password: randomOauthPassword(),
              display_name: profile.name,
            },
            createSystemOperationContext({})
          ) as { id: string };
          userId = created.id;
        }
        core
          .prepare(
            `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, profile_json, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(provider, provider_user_id) DO UPDATE SET
               user_id=excluded.user_id, updated_at=datetime('now')`
          )
          .run(provider, profile.providerUserId, userId, JSON.stringify(profile));
      }
      // Provider already required a verified email — mark account verified.
      core
        .prepare(
          `UPDATE users SET email_verified_at=COALESCE(email_verified_at, datetime('now')),
             updated_at=datetime('now') WHERE id=?`
        )
        .run(userId!);
      const user = core.prepare("SELECT * FROM users WHERE id=?").get(userId!) as CoreUser;
      if (mfaEnabled(core, user.id)) {
        const mfaToken = issueAuthToken(core, {
          userId: user.id,
          purpose: "mfa_login",
          ttlMinutes: 5,
        });
        res.redirect(
          `${config.web.publicUrl.replace(/\/$/, "")}/login?mfaToken=${encodeURIComponent(mfaToken)}`
        );
        return;
      }
      const sessionId = createSession(core, user.id, config.auth.sessionTtlDays);
      res.setHeader(
        "Set-Cookie",
        issueSessionCookies(sessionId, config.auth.sessionTtlDays, secure)
      );
      res.redirect(config.web.publicUrl.replace(/\/$/, "") || "/");
    } catch (err) {
      console.error("[oauth]", err);
      res.status(502).send("OAuth failed");
    }
  });

  return router;
}

function randomOauthPassword(): string {
  return `oauth$${randomBytes(24).toString("hex")}`;
}

async function exchangeOauthCode(
  provider: string,
  code: string
): Promise<{ providerUserId: string; email: string; name: string }> {
  const redirectUri = `${config.auth.publicUrl.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
  if (provider === "google") {
    const { clientId, clientSecret } = config.oauth.google;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileRes.ok) throw new Error(await profileRes.text());
    const p = (await profileRes.json()) as {
      id?: string;
      email?: string;
      name?: string;
      verified_email?: boolean;
    };
    if (!p.id || !p.email || !p.verified_email) throw new Error("Google email not verified");
    return {
      providerUserId: p.id,
      email: p.email.toLowerCase(),
      name: p.name ?? p.email,
    };
  }
  if (provider === "github") {
    const { clientId, clientSecret } = config.oauth.github;
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!userRes.ok) throw new Error(await userRes.text());
    const u = (await userRes.json()) as { id?: number; login?: string; email?: string | null; name?: string | null };
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!emailsRes.ok) throw new Error(await emailsRes.text());
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const email =
      emails.find((e) => e.primary && e.verified)?.email ??
      emails.find((e) => e.verified)?.email ??
      "";
    if (!u.id || !email) throw new Error("GitHub verified email unavailable");
    return {
      providerUserId: String(u.id),
      email: email.toLowerCase(),
      name: u.name ?? u.login ?? email,
    };
  }
  throw new Error("Unknown provider");
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
