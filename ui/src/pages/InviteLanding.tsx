import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import type { AgentAdapterType, JoinRequest } from "@paperclipai/shared";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyPatternIcon } from "@/components/CompanyPatternIcon";
import { Link, useParams } from "@/lib/router";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { getAdapterLabel } from "../adapters/adapter-display-registry";
import { rememberPendingInviteToken, clearPendingInviteToken } from "../lib/invite-memory";
import { queryKeys } from "../lib/queryKeys";

type JoinType = "human" | "agent";
type AuthMode = "sign_in" | "sign_up";

const joinAdapterOptions: AgentAdapterType[] = [...AGENT_ADAPTER_TYPES];
const ENABLED_INVITE_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
  "pi_local",
  "cursor",
]);

function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

function hexToRgba(hex: string | null | undefined, alpha: number) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    return `rgba(15, 118, 110, ${alpha})`;
  }
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatHumanRole(role: string | null | undefined) {
  if (!role) return null;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function InviteLandingPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const token = (params.token ?? "").trim();
  const [joinType, setJoinType] = useState<JoinType>("human");
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agentName, setAgentName] = useState("");
  const [adapterType, setAdapterType] = useState<AgentAdapterType>("claude_local");
  const [capabilities, setCapabilities] = useState("");
  const [result, setResult] = useState<{ kind: "bootstrap" | "join"; payload: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const inviteQuery = useQuery({
    queryKey: queryKeys.access.invite(token),
    queryFn: () => accessApi.getInvite(token),
    enabled: token.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (token) rememberPendingInviteToken(token);
  }, [token]);

  const invite = inviteQuery.data;
  const companyName = invite?.companyName?.trim() || null;
  const companyLogoUrl = invite?.companyLogoUrl?.trim() || null;
  const companyBrandColor = invite?.companyBrandColor?.trim() || null;
  const companyDisplayName = companyName || "this Paperclip company";
  const availableJoinTypes = useMemo(() => {
    if (invite?.inviteType === "bootstrap_ceo") return ["human"] as JoinType[];
    if (invite?.allowedJoinTypes === "both") return ["human", "agent"] as JoinType[];
    return [(invite?.allowedJoinTypes ?? "human") as JoinType];
  }, [invite?.allowedJoinTypes, invite?.inviteType]);

  useEffect(() => {
    if (!availableJoinTypes.includes(joinType)) {
      setJoinType(availableJoinTypes[0] ?? "human");
    }
  }, [availableJoinTypes, joinType]);

  const requiresAccount =
    healthQuery.data?.deploymentMode === "authenticated" &&
    !sessionQuery.data &&
    (invite?.inviteType === "bootstrap_ceo" || joinType === "human");

  const sessionLabel =
    sessionQuery.data?.user.name?.trim() ||
    sessionQuery.data?.user.email?.trim() ||
    "this account";
  const requestedRole = formatHumanRole(invite?.humanRole);
  const authCanSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (authMode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!invite) throw new Error("Invite not found");
      if (invite.inviteType === "bootstrap_ceo") {
        return accessApi.acceptInvite(token, { requestType: "human" });
      }
      if (joinType === "human") {
        return accessApi.acceptInvite(token, { requestType: "human" });
      }
      return accessApi.acceptInvite(token, {
        requestType: "agent",
        agentName: agentName.trim(),
        adapterType,
        capabilities: capabilities.trim() || null,
      });
    },
    onSuccess: async (payload) => {
      setError(null);
      clearPendingInviteToken(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      const asBootstrap =
        payload && typeof payload === "object" && "bootstrapAccepted" in (payload as Record<string, unknown>);
      setResult({ kind: asBootstrap ? "bootstrap" : "join", payload });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    },
  });

  const authMutation = useMutation({
    mutationFn: async () => {
      if (authMode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setAuthError(null);
      rememberPendingInviteToken(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  if (!token) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">Invalid invite token.</div>;
  }

  if (inviteQuery.isLoading || healthQuery.isLoading || sessionQuery.isLoading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading invite...</div>;
  }

  if (inviteQuery.error || !invite) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-lg border border-border bg-card p-6" data-testid="invite-error">
          <h1 className="text-lg font-semibold">Invite not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This invite may be expired, revoked, or already used.
          </p>
        </div>
      </div>
    );
  }

  if (result?.kind === "bootstrap") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Bootstrap complete</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The first instance admin is now configured. You can continue to the board.
          </p>
          <Button asChild className="mt-4">
            <Link to="/">Open board</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (result?.kind === "join") {
    const payload = result.payload as JoinRequest & {
      claimSecret?: string;
      claimApiKeyPath?: string;
      onboarding?: Record<string, unknown>;
      diagnostics?: Array<{
        code: string;
        level: "info" | "warn";
        message: string;
        hint?: string;
      }>;
    };
    const claimSecret = typeof payload.claimSecret === "string" ? payload.claimSecret : null;
    const claimApiKeyPath = typeof payload.claimApiKeyPath === "string" ? payload.claimApiKeyPath : null;
    const onboardingSkillUrl = readNestedString(payload.onboarding, ["skill", "url"]);
    const onboardingSkillPath = readNestedString(payload.onboarding, ["skill", "path"]);
    const onboardingInstallPath = readNestedString(payload.onboarding, ["skill", "installPath"]);
    const onboardingTextUrl = readNestedString(payload.onboarding, ["textInstructions", "url"]);
    const onboardingTextPath = readNestedString(payload.onboarding, ["textInstructions", "path"]);
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    const personalAccessApproved = joinType === "human" && payload.status === "approved";
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">
            {personalAccessApproved ? "You joined the company" : "Access request submitted"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {personalAccessApproved
              ? "Your membership is active now. You can continue to the board."
              : "Your request is pending admin approval. You will not have access until approved."}
          </p>
          <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Request ID: <span className="font-mono">{payload.id}</span>
          </div>
          {personalAccessApproved && (
            <Button asChild className="mt-4">
              <Link to="/">Open board</Link>
            </Button>
          )}
          {claimSecret && claimApiKeyPath && (
            <div className="mt-3 space-y-1 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">One-time claim secret (save now)</p>
              <p className="font-mono break-all">{claimSecret}</p>
              <p className="font-mono break-all">POST {claimApiKeyPath}</p>
            </div>
          )}
          {(onboardingSkillUrl || onboardingSkillPath || onboardingInstallPath) && (
            <div className="mt-3 space-y-1 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Paperclip skill bootstrap</p>
              {onboardingSkillUrl && <p className="font-mono break-all">GET {onboardingSkillUrl}</p>}
              {!onboardingSkillUrl && onboardingSkillPath && <p className="font-mono break-all">GET {onboardingSkillPath}</p>}
              {onboardingInstallPath && <p className="font-mono break-all">Install to {onboardingInstallPath}</p>}
            </div>
          )}
          {(onboardingTextUrl || onboardingTextPath) && (
            <div className="mt-3 space-y-1 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Agent-readable onboarding text</p>
              {onboardingTextUrl && <p className="font-mono break-all">GET {onboardingTextUrl}</p>}
              {!onboardingTextUrl && onboardingTextPath && <p className="font-mono break-all">GET {onboardingTextPath}</p>}
            </div>
          )}
          {diagnostics.length > 0 && (
            <div className="mt-3 space-y-1 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Connectivity diagnostics</p>
              {diagnostics.map((diag, idx) => (
                <div key={`${diag.code}:${idx}`} className="space-y-0.5">
                  <p className={diag.level === "warn" ? "text-amber-600 dark:text-amber-400" : undefined}>
                    [{diag.level}] {diag.message}
                  </p>
                  {diag.hint && <p className="font-mono break-all">{diag.hint}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const canSubmitJoin =
    !requiresAccount &&
    !acceptMutation.isPending &&
    (joinType !== "agent" || invite.inviteType === "bootstrap_ceo" || agentName.trim().length > 0);

  return (
    <div
      className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8"
      style={{
        backgroundImage: [
          `radial-gradient(circle at top left, ${hexToRgba(companyBrandColor, 0.18)}, transparent 36%)`,
          `radial-gradient(circle at bottom right, ${hexToRgba(companyBrandColor, 0.1)}, transparent 32%)`,
          "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,248,245,0.98))",
        ].join(", "),
      }}
    >
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.2fr)_24rem]">
        <section className="overflow-hidden rounded-[28px] border border-border/70 bg-card/95 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <div
            className="border-b border-border/70 px-6 py-6 sm:px-8"
            style={{
              backgroundImage: `linear-gradient(135deg, ${hexToRgba(companyBrandColor, 0.16)}, transparent 58%)`,
            }}
          >
            <div className="flex items-start gap-4">
              <CompanyPatternIcon
                companyName={companyDisplayName}
                logoUrl={companyLogoUrl}
                brandColor={companyBrandColor}
                className="h-16 w-16 rounded-[20px] text-xl shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Invite ready
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {invite.inviteType === "bootstrap_ceo"
                    ? "Set up your Paperclip instance"
                    : `Join ${companyDisplayName}`}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  {invite.inviteType === "bootstrap_ceo"
                    ? "Finish creating the first operator account without leaving this page."
                    : "Review the invite, sign in or create an account inline if needed, and keep this invite in place until you finish."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Access
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {invite.inviteType === "bootstrap_ceo"
                      ? "Instance setup"
                      : invite.allowedJoinTypes === "both"
                        ? "Personal or agent"
                        : invite.allowedJoinTypes === "agent"
                          ? "Agent"
                          : "Personal"}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Default role
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{requestedRole ?? "Review on submit"}</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Expires
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{dateTime(invite.expiresAt)}</div>
                </div>
              </div>

              {invite.inviteMessage ? (
                <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm leading-6 text-foreground">
                  {invite.inviteMessage}
                </div>
              ) : null}

              {invite.inviteType !== "bootstrap_ceo" ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Choose your path
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {availableJoinTypes.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setError(null);
                          setJoinType(type);
                        }}
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                          joinType === type
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-background text-foreground hover:border-foreground/40"
                        }`}
                      >
                        {type === "human" ? "Personal access" : "Agent access"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-3xl border border-border/70 bg-background/70 p-5">
                <div className="text-sm font-semibold text-foreground">
                  {invite.inviteType === "bootstrap_ceo"
                    ? "What happens next"
                    : joinType === "human"
                      ? "How personal access works"
                      : "How agent access works"}
                </div>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  {(invite.inviteType === "bootstrap_ceo" || joinType === "human") ? (
                    <>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>Stay on this page while you sign in or create an account.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>The invite stays remembered locally until you finish the flow.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>After submit, access is activated immediately or routed for approval, depending on company policy.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>Choose the adapter and name for the agent you want to connect.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>Paperclip returns the one-time claim secret and onboarding endpoints right here.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
                        <p>Admins can still review the request before the agent gets company access.</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <aside className="rounded-3xl border border-border/70 bg-background/90 p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Continue
              </div>
              <div className="mt-2 text-lg font-semibold text-foreground">
                {requiresAccount
                  ? authMode === "sign_in"
                    ? "Sign in to continue"
                    : "Create an account to continue"
                  : invite.inviteType === "bootstrap_ceo"
                    ? "Finish bootstrap"
                    : joinType === "human"
                      ? "Use your account"
                      : "Connect an agent"}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {requiresAccount
                  ? "This invite stays on deck while you authenticate."
                  : invite.inviteType === "bootstrap_ceo"
                    ? `Signed in as ${sessionLabel}.`
                    : joinType === "human"
                      ? `This invite will be submitted for ${sessionLabel}.`
                      : "Fill in the agent details and submit the request."}
              </p>

              {invite.inviteType !== "bootstrap_ceo" && joinType === "agent" ? (
                <div className="mt-5 space-y-3">
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Agent name</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                      value={agentName}
                      onChange={(event) => setAgentName(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Adapter type</span>
                    <select
                      className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                      value={adapterType}
                      onChange={(event) => setAdapterType(event.target.value as AgentAdapterType)}
                    >
                      {joinAdapterOptions.map((type) => (
                        <option key={type} value={type} disabled={!ENABLED_INVITE_ADAPTERS.has(type)}>
                          {getAdapterLabel(type)}{!ENABLED_INVITE_ADAPTERS.has(type) ? " (Coming soon)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Capabilities (optional)</span>
                    <textarea
                      className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                      rows={4}
                      value={capabilities}
                      onChange={(event) => setCapabilities(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}

              {requiresAccount ? (
                <div className="mt-5 rounded-3xl border border-border/70 bg-muted/20 p-4" data-testid="invite-inline-auth">
                  <div className="mb-4 inline-flex rounded-full border border-border bg-background p-1">
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        authMode === "sign_in" ? "bg-foreground text-background" : "text-muted-foreground"
                      }`}
                      onClick={() => {
                        setAuthError(null);
                        setAuthMode("sign_in");
                      }}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        authMode === "sign_up" ? "bg-foreground text-background" : "text-muted-foreground"
                      }`}
                      onClick={() => {
                        setAuthError(null);
                        setAuthMode("sign_up");
                      }}
                    >
                      Create account
                    </button>
                  </div>

                  <form
                    className="space-y-3"
                    method="post"
                    action={authMode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (authMutation.isPending) return;
                      if (!authCanSubmit) {
                        setAuthError("Please fill in all required fields.");
                        return;
                      }
                      authMutation.mutate();
                    }}
                  >
                    {authMode === "sign_up" ? (
                      <label className="block text-sm">
                        <span className="mb-1 block text-muted-foreground">Name</span>
                        <input
                          name="name"
                          className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          autoComplete="name"
                        />
                      </label>
                    ) : null}
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">Email</span>
                      <input
                        name="email"
                        type="email"
                        className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">Password</span>
                      <input
                        name="password"
                        type="password"
                        className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-1 focus:ring-ring"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete={authMode === "sign_in" ? "current-password" : "new-password"}
                      />
                    </label>
                    {authError ? <p className="text-xs text-destructive">{authError}</p> : null}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={authMutation.isPending}
                      aria-disabled={!authCanSubmit || authMutation.isPending}
                    >
                      {authMutation.isPending
                        ? "Working..."
                        : authMode === "sign_in"
                          ? "Sign in and continue"
                          : "Create account and continue"}
                    </Button>
                  </form>

                  <div className="mt-3 text-xs text-muted-foreground">
                    Prefer the full auth page?{" "}
                    <Link
                      className="font-medium text-foreground underline underline-offset-2"
                      to={`/auth?next=${encodeURIComponent(`/invite/${token}`)}`}
                    >
                      Open auth in a separate page
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                    {invite.inviteType === "bootstrap_ceo" || joinType === "human"
                      ? `Ready to continue as ${sessionLabel}.`
                      : "Ready to submit the agent request."}
                  </div>
                  {error ? <p className="text-sm text-destructive">{error}</p> : null}
                  <Button className="w-full justify-between" disabled={!canSubmitJoin} onClick={() => acceptMutation.mutate()}>
                    <span>
                      {acceptMutation.isPending
                        ? "Submitting..."
                        : invite.inviteType === "bootstrap_ceo"
                          ? "Accept bootstrap invite"
                          : joinType === "human"
                            ? "Join company"
                            : "Submit agent request"}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
