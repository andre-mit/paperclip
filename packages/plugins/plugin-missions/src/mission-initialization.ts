import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import {
  MISSION_REQUIRED_DOCUMENT_KEYS,
  isValidationReportDocumentKey,
  parseMissionFeaturesDocument,
  parseMissionValidationContractDocument,
  parseMissionValidationReportDocument,
  parseValidationReportRound,
  type MissionRequiredDocumentKey,
  type MissionState,
} from "./mission-documents.js";

type MissionInitializationActor = {
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type PersistedMissionRecord = {
  missionIssueId: string;
  companyId: string;
  state: MissionState;
  billingCode: string | null;
  rootOriginKind: string | null;
  rootOriginId: string | null;
  settings: Record<string, unknown>;
  initializedAt: string;
  updatedAt: string;
  hasRootLink: boolean;
  hasInitializationEvent: boolean;
};

export type MissionParseProblem = {
  issueId: string;
  key: string;
  message: string;
};

export type MissionDocumentChecklistItem = {
  key: MissionRequiredDocumentKey;
  present: boolean;
  title: string | null;
};

export type MissionValidationReportSummary = {
  key: string;
  title: string | null;
  round: number;
  summary: string;
  findingCount: number;
  updatedAt: string;
};

export type MissionIssueSummary = {
  issueId: string;
  isMission: boolean;
  canInitialize: boolean;
  initializeDisabledReason: string | null;
  state: MissionState | null;
  nextAction: string;
  documentChecklist: MissionDocumentChecklistItem[];
  missingRequiredDocumentKeys: MissionRequiredDocumentKey[];
  parseProblems: MissionParseProblem[];
  validationReports: MissionValidationReportSummary[];
  openFindingCount: number;
  settings: {
    billingCode: string | null;
    rootOriginKind: string | null;
    rootOriginId: string | null;
    databaseNamespace: string;
    requiredDocumentKeys: readonly MissionRequiredDocumentKey[];
  };
  persistence: PersistedMissionRecord | null;
};

export type MissionInitializationResult = {
  created: boolean;
  issueId: string;
  createdDocumentKeys: MissionRequiredDocumentKey[];
  summary: MissionIssueSummary;
};

const PERSISTENCE_STATE_NAMESPACE = "mission-initialization";
const PERSISTENCE_STATE_KEY = "persisted";
const DEFAULT_MISSION_STATE: MissionState = "draft";

const REQUIRED_DOCUMENT_TITLES: Record<MissionRequiredDocumentKey, string> = {
  plan: "Mission Plan",
  "mission-brief": "Mission Brief",
  "validation-contract": "Validation Contract",
  features: "Features",
  "worker-guidelines": "Worker Guidelines",
  services: "Services",
  "knowledge-base": "Knowledge Base",
  "decision-log": "Decision Log",
};

function pluginOriginPrefix(ctx: PluginContext) {
  return `plugin:${ctx.manifest.id}`;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

async function getPersistedMissionFallback(ctx: PluginContext, issueId: string) {
  const fallback = await ctx.state.get({
    scopeKind: "issue",
    scopeId: issueId,
    namespace: PERSISTENCE_STATE_NAMESPACE,
    stateKey: PERSISTENCE_STATE_KEY,
  });
  return fallback && typeof fallback === "object" ? fallback as PersistedMissionRecord : null;
}

async function setPersistedMissionFallback(ctx: PluginContext, issueId: string, record: PersistedMissionRecord) {
  await ctx.state.set(
    {
      scopeKind: "issue",
      scopeId: issueId,
      namespace: PERSISTENCE_STATE_NAMESPACE,
      stateKey: PERSISTENCE_STATE_KEY,
    },
    record,
  );
}

async function getMissionByRootIssue(ctx: PluginContext, companyId: string, issueId: string) {
  const namespace = ctx.db.namespace;
  const rows = await ctx.db.query<{
    mission_issue_id: string;
    company_id: string;
    state: string;
    billing_code: string | null;
    root_origin_kind: string | null;
    root_origin_id: string | null;
    settings_json_text: string;
    initialized_at: string | Date;
    updated_at: string | Date;
    has_root_link: boolean;
    has_initialization_event: boolean;
  }>(
    `SELECT
       m.mission_issue_id,
       m.company_id,
       m.state,
       m.billing_code,
       m.root_origin_kind,
       m.root_origin_id,
       m.settings_json::text AS settings_json_text,
       m.initialized_at,
       m.updated_at,
       EXISTS(
         SELECT 1
         FROM ${namespace}.mission_issue_links l
         WHERE l.mission_issue_id = m.mission_issue_id
           AND l.generated_issue_id = m.mission_issue_id
           AND l.generated_kind = 'root'
           AND l.generated_key = 'root'
       ) AS has_root_link,
       EXISTS(
         SELECT 1
         FROM ${namespace}.mission_events e
         WHERE e.mission_issue_id = m.mission_issue_id
           AND e.event_key = 'initialized'
       ) AS has_initialization_event
     FROM ${namespace}.missions m
     WHERE m.company_id = $1
       AND m.mission_issue_id = $2
     LIMIT 1`,
    [companyId, issueId],
  );

  const row = rows[0];
  if (!row) return getPersistedMissionFallback(ctx, issueId);

  const record: PersistedMissionRecord = {
    missionIssueId: row.mission_issue_id,
    companyId: row.company_id,
    state: (row.state as MissionState) ?? DEFAULT_MISSION_STATE,
    billingCode: row.billing_code,
    rootOriginKind: row.root_origin_kind,
    rootOriginId: row.root_origin_id,
    settings: JSON.parse(row.settings_json_text || "{}") as Record<string, unknown>,
    initializedAt: normalizeTimestamp(row.initialized_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    hasRootLink: Boolean(row.has_root_link),
    hasInitializationEvent: Boolean(row.has_initialization_event),
  };
  await setPersistedMissionFallback(ctx, issueId, record);
  return record;
}

function buildDocumentBody(key: MissionRequiredDocumentKey, issue: Issue) {
  switch (key) {
    case "plan":
      return [
        "# Mission Plan",
        "",
        "## Objective",
        issue.title,
        "",
        "## Scope",
        issue.description?.trim() || "Capture the concrete operator scope for this mission.",
        "",
        "## Risks",
        "- Document the main execution risks before decomposition.",
      ].join("\n");
    case "mission-brief":
      return [
        "# Mission Brief",
        "",
        `- Root issue: ${issue.title}`,
        `- Identifier: ${issue.identifier ?? issue.id}`,
        `- Billing code: ${issue.billingCode ?? `mission:${issue.id}`}`,
        "",
        "## Desired outcome",
        "Describe the operator-visible outcome this mission must deliver.",
      ].join("\n");
    case "validation-contract":
      return JSON.stringify(
        {
          assertions: [
            {
              id: "VAL-MISSION-001",
              title: "Mission outcome is validated",
              user_value: "The mission solves the root issue for the operator.",
              scope: "Root mission issue",
              setup: "Replace this placeholder with the setup needed to validate the mission.",
              steps: ["Replace this placeholder with concrete validation steps."],
              oracle: "Reference the evidence that proves the mission outcome worked.",
              tooling: ["manual_review"],
              evidence: [
                {
                  kind: "primary",
                  description: "Attach the operator-facing proof artifact for the completed mission.",
                  required: true,
                },
              ],
              claimed_by: [],
              status: "draft",
            },
          ],
        },
        null,
        2,
      );
    case "features":
      return JSON.stringify(
        {
          milestones: [
            {
              id: "MILESTONE-MISSION-001",
              title: "Initial mission slice",
              summary: "Replace this placeholder with the first bounded milestone.",
              features: [
                {
                  id: "FEAT-MISSION-001",
                  title: "Draft feature slice",
                  kind: "original",
                  summary: "Replace this placeholder with the first concrete feature or task slice.",
                  acceptance_criteria: ["Replace this placeholder with concrete acceptance criteria."],
                  claimed_assertion_ids: [],
                  status: "planned",
                },
              ],
            },
          ],
        },
        null,
        2,
      );
    case "worker-guidelines":
      return [
        "# Worker Guidelines",
        "",
        "- Keep changes scoped to the root mission goal.",
        "- Leave operator-readable progress in comments and documents.",
        "- Capture verification evidence in the validation artifacts.",
      ].join("\n");
    case "services":
      return [
        "# Services",
        "",
        "- Record external services, APIs, and environments this mission depends on.",
      ].join("\n");
    case "knowledge-base":
      return [
        "# Knowledge Base",
        "",
        "- Capture durable discoveries, links, and references for this mission here.",
      ].join("\n");
    case "decision-log":
      return [
        "# Decision Log",
        "",
        "- Record mission-level decisions, tradeoffs, and approvals here.",
      ].join("\n");
  }
}

async function ensureMissionDocuments(ctx: PluginContext, companyId: string, issue: Issue) {
  const existing = await ctx.issues.documents.list(issue.id, companyId);
  const existingKeys = new Set(existing.map((document) => document.key));
  const createdDocumentKeys: MissionRequiredDocumentKey[] = [];

  for (const key of MISSION_REQUIRED_DOCUMENT_KEYS) {
    if (existingKeys.has(key)) continue;
    await ctx.issues.documents.upsert({
      issueId: issue.id,
      companyId,
      key,
      title: REQUIRED_DOCUMENT_TITLES[key],
      body: buildDocumentBody(key, issue),
      changeSummary: "Initialized mission document bundle",
    });
    createdDocumentKeys.push(key);
  }

  return createdDocumentKeys;
}

async function ensureRootIssueMetadata(
  ctx: PluginContext,
  companyId: string,
  issue: Issue,
  actor: MissionInitializationActor,
) {
  const originPrefix = pluginOriginPrefix(ctx);
  const originKind = issue.originKind ?? "manual";
  const canAdoptOrigin = originKind === "manual" || originKind === originPrefix || originKind.startsWith(`${originPrefix}:`);
  if (!canAdoptOrigin) {
    throw new Error(`Issue origin '${originKind}' is already owned by another workflow`);
  }

  const patch: Parameters<PluginContext["issues"]["update"]>[1] = {};
  const finalOriginKind = originKind === "manual" ? originPrefix : originKind;
  const finalOriginId = issue.originId ?? `mission:${issue.id}`;
  const finalBillingCode = issue.billingCode ?? `mission:${issue.id}`;

  if (issue.originKind !== finalOriginKind) patch.originKind = finalOriginKind as Issue["originKind"];
  if (issue.originId !== finalOriginId) patch.originId = finalOriginId;
  if (issue.billingCode !== finalBillingCode) patch.billingCode = finalBillingCode;

  if (Object.keys(patch).length === 0) {
    return {
      issue,
      finalOriginKind,
      finalOriginId,
      finalBillingCode,
    };
  }

  const updated = await ctx.issues.update(issue.id, patch, companyId, actor);
  return {
    issue: updated,
    finalOriginKind,
    finalOriginId,
    finalBillingCode,
  };
}

function buildPersistedSettings(ctx: PluginContext, issue: Issue, billingCode: string) {
  return {
    pluginId: ctx.manifest.id,
    databaseNamespace: ctx.db.namespace,
    requiredDocumentKeys: [...MISSION_REQUIRED_DOCUMENT_KEYS],
    initializedFromStatus: issue.status,
    rootIdentifier: issue.identifier ?? issue.id,
    billingCode,
  };
}

async function persistMissionInitialization(
  ctx: PluginContext,
  input: {
    companyId: string;
    issue: Issue;
    rootOriginKind: string;
    rootOriginId: string;
    billingCode: string;
    createdDocumentKeys: MissionRequiredDocumentKey[];
    actor: MissionInitializationActor;
  },
) {
  const namespace = ctx.db.namespace;
  const settings = buildPersistedSettings(ctx, input.issue, input.billingCode);

  await ctx.db.execute(
    `INSERT INTO ${namespace}.missions (
       mission_issue_id,
       company_id,
       state,
       billing_code,
       root_origin_kind,
       root_origin_id,
       settings_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (mission_issue_id) DO UPDATE SET
       billing_code = EXCLUDED.billing_code,
       root_origin_kind = EXCLUDED.root_origin_kind,
       root_origin_id = EXCLUDED.root_origin_id,
       updated_at = now()`,
    [
      input.issue.id,
      input.companyId,
      DEFAULT_MISSION_STATE,
      input.billingCode,
      input.rootOriginKind,
      input.rootOriginId,
      JSON.stringify(settings),
    ],
  );

  await ctx.db.execute(
    `INSERT INTO ${namespace}.mission_issue_links (
       mission_issue_id,
       generated_issue_id,
       generated_kind,
       generated_key,
       origin_kind,
       origin_id
     ) VALUES ($1, $2, 'root', 'root', $3, $4)
     ON CONFLICT (mission_issue_id, generated_kind, generated_key) DO UPDATE SET
       origin_kind = EXCLUDED.origin_kind,
       origin_id = EXCLUDED.origin_id,
       updated_at = now()`,
    [input.issue.id, input.issue.id, input.rootOriginKind, input.rootOriginId],
  );

  const payload = {
    actorAgentId: input.actor.actorAgentId ?? null,
    actorUserId: input.actor.actorUserId ?? null,
    actorRunId: input.actor.actorRunId ?? null,
    createdDocumentKeys: input.createdDocumentKeys,
  };
  await ctx.db.execute(
    `INSERT INTO ${namespace}.mission_events (
       mission_issue_id,
       company_id,
       event_key,
       event_type,
       payload_json
     ) VALUES ($1, $2, 'initialized', 'mission_initialized', $3::jsonb)
     ON CONFLICT (mission_issue_id, event_key) DO UPDATE SET
       payload_json = EXCLUDED.payload_json,
       updated_at = now()`,
    [input.issue.id, input.companyId, JSON.stringify(payload)],
  );

  const record: PersistedMissionRecord = {
    missionIssueId: input.issue.id,
    companyId: input.companyId,
    state: DEFAULT_MISSION_STATE,
    billingCode: input.billingCode,
    rootOriginKind: input.rootOriginKind,
    rootOriginId: input.rootOriginId,
    settings,
    initializedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasRootLink: true,
    hasInitializationEvent: true,
  };
  await setPersistedMissionFallback(ctx, input.issue.id, record);
}

export async function buildMissionIssueSummary(ctx: PluginContext, companyId: string, issueId: string): Promise<MissionIssueSummary> {
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);

  const persisted = await getMissionByRootIssue(ctx, companyId, issueId);
  const documents = await ctx.issues.documents.list(issueId, companyId);
  const checklist: MissionDocumentChecklistItem[] = MISSION_REQUIRED_DOCUMENT_KEYS.map((key) => {
    const document = documents.find((candidate) => candidate.key === key);
    return {
      key,
      present: Boolean(document),
      title: document?.title ?? null,
    };
  });
  const missingRequiredDocumentKeys = checklist.filter((item) => !item.present).map((item) => item.key);
  const parseProblems: MissionParseProblem[] = [];
  const validationReports: MissionValidationReportSummary[] = [];
  let openFindingCount = 0;

  const relevantKeys = new Set(
    documents
      .map((document) => document.key)
      .filter((key) => key === "validation-contract" || key === "features" || isValidationReportDocumentKey(key)),
  );

  for (const key of relevantKeys) {
    const document = await ctx.issues.documents.get(issueId, key, companyId);
    if (!document) continue;
    try {
      if (key === "validation-contract") {
        parseMissionValidationContractDocument(document.body);
        continue;
      }
      if (key === "features") {
        parseMissionFeaturesDocument(document.body);
        continue;
      }
      if (!isValidationReportDocumentKey(key)) continue;
      const parsed = parseMissionValidationReportDocument(document.body, {
        round: parseValidationReportRound(key) ?? undefined,
      });
      validationReports.push({
        key,
        title: document.title,
        round: parsed.round,
        summary: parsed.summary,
        findingCount: parsed.findings.length,
        updatedAt: normalizeTimestamp(document.updatedAt),
      });
      openFindingCount += parsed.findings.filter((finding) => finding.status === "open").length;
    } catch (error) {
      parseProblems.push({
        issueId,
        key,
        message: stringifyError(error),
      });
    }
  }

  validationReports.sort((left, right) => left.round - right.round);

  const originPrefix = pluginOriginPrefix(ctx);
  const issueOriginKind = issue.originKind ?? null;
  const initializeDisabledReason = persisted
    ? "This issue is already initialized as a mission."
    : issueOriginKind === "manual" ||
        issueOriginKind === originPrefix ||
        (issueOriginKind !== null && issueOriginKind.startsWith(`${originPrefix}:`))
      ? null
      : `Issue origin '${issue.originKind}' is already owned by another workflow.`;

  const nextAction = !persisted
    ? "Initialize this issue as a mission to create the namespace rows and document bundle."
    : missingRequiredDocumentKeys.length > 0
      ? "Complete the missing mission documents before decomposition."
      : parseProblems.length > 0
        ? "Repair invalid mission documents before decomposition."
        : persisted.state === "draft"
          ? "Review the mission brief, validation contract, and feature plan before decomposition."
          : "Mission initialization is complete.";

  return {
    issueId,
    isMission: Boolean(persisted),
    canInitialize: !persisted && initializeDisabledReason === null,
    initializeDisabledReason,
    state: persisted?.state ?? null,
    nextAction,
    documentChecklist: checklist,
    missingRequiredDocumentKeys,
    parseProblems,
    validationReports,
    openFindingCount,
    settings: {
      billingCode: persisted?.billingCode ?? issue.billingCode ?? null,
      rootOriginKind: persisted?.rootOriginKind ?? issue.originKind ?? null,
      rootOriginId: persisted?.rootOriginId ?? issue.originId ?? null,
      databaseNamespace: ctx.db.namespace,
      requiredDocumentKeys: MISSION_REQUIRED_DOCUMENT_KEYS,
    },
    persistence: persisted,
  };
}

export async function initializeMission(
  ctx: PluginContext,
  input: {
    companyId: string;
    issueId: string;
    actorAgentId?: string | null;
    actorUserId?: string | null;
    actorRunId?: string | null;
  },
): Promise<MissionInitializationResult> {
  const actor = {
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorRunId: input.actorRunId ?? null,
  };
  const issue = await ctx.issues.get(input.issueId, input.companyId);
  if (!issue) {
    throw new Error(`Issue not found: ${input.issueId}`);
  }

  if (actor.actorAgentId && actor.actorRunId && issue.status === "in_progress" && issue.assigneeAgentId === actor.actorAgentId) {
    await ctx.issues.assertCheckoutOwner({
      issueId: issue.id,
      companyId: input.companyId,
      actorAgentId: actor.actorAgentId,
      actorRunId: actor.actorRunId,
    });
  }

  const persistedBefore = await getMissionByRootIssue(ctx, input.companyId, issue.id);
  const {
    issue: updatedIssue,
    finalOriginKind,
    finalOriginId,
    finalBillingCode,
  } = await ensureRootIssueMetadata(ctx, input.companyId, issue, actor);

  const createdDocumentKeys = await ensureMissionDocuments(ctx, input.companyId, updatedIssue);
  await persistMissionInitialization(ctx, {
    companyId: input.companyId,
    issue: updatedIssue,
    rootOriginKind: finalOriginKind,
    rootOriginId: finalOriginId,
    billingCode: finalBillingCode,
    createdDocumentKeys,
    actor,
  });

  return {
    created: !persistedBefore,
    issueId: updatedIssue.id,
    createdDocumentKeys,
    summary: await buildMissionIssueSummary(ctx, input.companyId, updatedIssue.id),
  };
}
