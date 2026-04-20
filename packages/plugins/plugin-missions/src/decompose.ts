import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import {
  parseMissionFeaturesDocument,
  parseMissionValidationContractDocument,
  type MissionFeature,
  type MissionMilestone,
} from "./mission-documents.js";

type GeneratedIssueKind = "milestone" | "feature" | "validation";

type DecomposeActor = {
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type GeneratedIssueSpec = {
  kind: GeneratedIssueKind;
  key: string;
  title: string;
  description: string;
  parentId: string;
  originKind: `plugin:${string}`;
  originId: string;
};

type DecomposedIssueResult = {
  kind: GeneratedIssueKind;
  key: string;
  issueId: string | null;
  identifier: string | null;
  title: string;
  created: boolean;
  blockedByIssueIds: string[];
};

export type MissionDecompositionResult = {
  missionIssueId: string;
  milestoneCount: number;
  featureCount: number;
  validationCount: number;
  createdIssueIds: string[];
  updatedIssueIds: string[];
  issues: DecomposedIssueResult[];
};

type MissionDocumentBundle = {
  validationContract: IssueDocumentLike;
  features: IssueDocumentLike;
  missionBrief: IssueDocumentLike | null;
  workerGuidelines: IssueDocumentLike | null;
  services: IssueDocumentLike | null;
  knowledgeBase: IssueDocumentLike | null;
};

type IssueDocumentLike = NonNullable<Awaited<ReturnType<PluginContext["issues"]["documents"]["get"]>>>;

function issueReference(issue: Pick<Issue, "identifier" | "id">) {
  if (!issue.identifier) return `\`${issue.id}\``;
  const prefix = issue.identifier.split("-")[0] || "PAP";
  return `[${issue.identifier}](/${prefix}/issues/${issue.identifier})`;
}

function billingCodeForMission(issue: Pick<Issue, "billingCode" | "identifier" | "id">) {
  return issue.billingCode?.trim() || `mission:${issue.identifier ?? issue.id}`;
}

function docContextLines(docs: MissionDocumentBundle) {
  return [
    docs.missionBrief ? "- Read `mission-brief` before execution." : null,
    docs.workerGuidelines ? "- Follow `worker-guidelines` for execution and handoff." : null,
    docs.services ? "- Use `services` for local commands and environment setup." : null,
    docs.knowledgeBase ? "- Check `knowledge-base` for prior discoveries and constraints." : null,
  ].filter((line): line is string => Boolean(line));
}

function summaryLines(summary: string) {
  return [summary.trim()].filter(Boolean);
}

function buildMilestoneDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionMilestone;
  docs: MissionDocumentBundle;
}) {
  const { mission, milestone, docs } = input;
  return [
    `Mission milestone generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${milestone.id}\``,
    "",
    "Summary:",
    ...summaryLines(milestone.summary),
    "",
    "Features in scope:",
    ...milestone.features.map((feature) => `- \`${feature.id}\` ${feature.title}`),
    ...(milestone.depends_on.length > 0
      ? ["", "Milestone dependencies:", ...milestone.depends_on.map((id) => `- \`${id}\``)]
      : []),
    ...(docContextLines(docs).length > 0 ? ["", "Context documents:", ...docContextLines(docs)] : []),
  ].join("\n");
}

function buildFeatureDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionMilestone;
  feature: MissionFeature;
  docs: MissionDocumentBundle;
}) {
  const { mission, milestone, feature, docs } = input;
  return [
    `Mission feature generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${feature.id}\``,
    `Milestone: \`${milestone.id}\` ${milestone.title}`,
    `Kind: \`${feature.kind}\``,
    "",
    "Summary:",
    ...summaryLines(feature.summary),
    "",
    "Claimed validation assertions:",
    ...feature.claimed_assertion_ids.map((id) => `- \`${id}\``),
    "",
    "Acceptance criteria:",
    ...feature.acceptance_criteria.map((criterion) => `- ${criterion}`),
    ...(feature.depends_on.length > 0
      ? ["", "Depends on features:", ...feature.depends_on.map((id) => `- \`${id}\``)]
      : []),
    ...(docContextLines(docs).length > 0 ? ["", "Context documents:", ...docContextLines(docs)] : []),
  ].join("\n");
}

function buildValidationDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionMilestone;
  docs: MissionDocumentBundle;
}) {
  const { mission, milestone, docs } = input;
  const assertionIds = [...new Set(milestone.features.flatMap((feature) => feature.claimed_assertion_ids))];
  return [
    `Mission validation gate generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${milestone.id}:validation\``,
    `Milestone: \`${milestone.id}\` ${milestone.title}`,
    "",
    "Validate the milestone after every feature dependency is complete.",
    "",
    "Assertions in scope:",
    ...assertionIds.map((assertionId) => `- \`${assertionId}\``),
    ...(docContextLines(docs).length > 0 ? ["", "Context documents:", ...docContextLines(docs)] : []),
  ].join("\n");
}

function featureOriginId(missionIssueId: string, featureId: string) {
  return `${missionIssueId}:feature:${featureId}`;
}

function milestoneOriginId(missionIssueId: string, milestoneId: string) {
  return `${missionIssueId}:milestone:${milestoneId}`;
}

function validationOriginId(missionIssueId: string, milestoneId: string) {
  return `${missionIssueId}:validation:${milestoneId}`;
}

function generatedOriginKind(ctx: PluginContext, kind: GeneratedIssueKind): `plugin:${string}` {
  return `plugin:${ctx.manifest.id}:${kind}` as `plugin:${string}`;
}

async function getMissionDocuments(ctx: PluginContext, issueId: string, companyId: string): Promise<MissionDocumentBundle> {
  const [
    validationContract,
    features,
    missionBrief,
    workerGuidelines,
    services,
    knowledgeBase,
  ] = await Promise.all([
    ctx.issues.documents.get(issueId, "validation-contract", companyId),
    ctx.issues.documents.get(issueId, "features", companyId),
    ctx.issues.documents.get(issueId, "mission-brief", companyId),
    ctx.issues.documents.get(issueId, "worker-guidelines", companyId),
    ctx.issues.documents.get(issueId, "services", companyId),
    ctx.issues.documents.get(issueId, "knowledge-base", companyId),
  ]);

  if (!validationContract) throw new Error("Mission requires a validation-contract document before decomposition");
  if (!features) throw new Error("Mission requires a features document before decomposition");

  return {
    validationContract,
    features,
    missionBrief,
    workerGuidelines,
    services,
    knowledgeBase,
  };
}

async function maybeAssertCheckoutOwner(ctx: PluginContext, mission: Issue, companyId: string, actor: DecomposeActor) {
  if (!actor.actorAgentId || !actor.actorRunId) return;
  if (mission.status !== "in_progress") return;
  await ctx.issues.assertCheckoutOwner({
    issueId: mission.id,
    companyId,
    actorAgentId: actor.actorAgentId,
    actorRunId: actor.actorRunId,
  });
}

async function findGeneratedIssue(
  ctx: PluginContext,
  companyId: string,
  originKind: GeneratedIssueSpec["originKind"],
  originId: string,
) {
  const existing = await ctx.issues.list({
    companyId,
    originKind,
    originId,
    limit: 1,
  });
  return existing[0] ?? null;
}

async function upsertGeneratedIssue(
  ctx: PluginContext,
  mission: Issue,
  companyId: string,
  actor: DecomposeActor,
  spec: GeneratedIssueSpec,
) {
  const existing = await findGeneratedIssue(ctx, companyId, spec.originKind, spec.originId);
  const updatePatch = {
    title: spec.title,
    description: spec.description,
    priority: "medium" as const,
    billingCode: billingCodeForMission(mission),
    originKind: spec.originKind,
    originId: spec.originId,
    executionWorkspaceId: mission.executionWorkspaceId ?? undefined,
    executionWorkspacePreference: mission.executionWorkspacePreference ?? undefined,
    executionWorkspaceSettings:
      (mission.executionWorkspaceSettings as Record<string, unknown> | null | undefined) ?? undefined,
  };

  if (existing) {
    const updated = await ctx.issues.update(existing.id, updatePatch, companyId, actor);
    return { issue: updated, created: false };
  }

  const created = await ctx.issues.create({
    companyId,
    projectId: mission.projectId ?? undefined,
    goalId: mission.goalId ?? undefined,
    parentId: spec.parentId,
    inheritExecutionWorkspaceFromIssueId: mission.id,
    title: spec.title,
    description: spec.description,
    status: "todo",
    priority: "medium",
    billingCode: billingCodeForMission(mission),
    originKind: spec.originKind,
    originId: spec.originId,
    executionWorkspaceId: mission.executionWorkspaceId ?? undefined,
    executionWorkspacePreference: mission.executionWorkspacePreference ?? undefined,
    executionWorkspaceSettings:
      (mission.executionWorkspaceSettings as Record<string, unknown> | null | undefined) ?? undefined,
    actor,
  });
  return { issue: created, created: true };
}

async function recordLink(
  ctx: PluginContext,
  missionIssueId: string,
  spec: GeneratedIssueSpec,
  generatedIssueId: string,
) {
  await ctx.db.execute(
    `INSERT INTO ${ctx.db.namespace}.mission_issue_links (
      mission_issue_id,
      generated_issue_id,
      generated_kind,
      generated_key,
      origin_kind,
      origin_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (mission_issue_id, generated_kind, generated_key) DO UPDATE SET
      generated_issue_id = EXCLUDED.generated_issue_id,
      origin_kind = EXCLUDED.origin_kind,
      origin_id = EXCLUDED.origin_id,
      updated_at = now()`,
    [missionIssueId, generatedIssueId, spec.kind, spec.key, spec.originKind, spec.originId],
  );
}

export async function decomposeMission(
  ctx: PluginContext,
  input: {
    issueId: string;
    companyId: string;
    dryRun?: boolean;
    actor?: DecomposeActor;
  },
): Promise<MissionDecompositionResult> {
  const actor = input.actor ?? {};
  const mission = await ctx.issues.get(input.issueId, input.companyId);
  if (!mission) throw new Error(`Mission issue not found: ${input.issueId}`);
  await maybeAssertCheckoutOwner(ctx, mission, input.companyId, actor);

  const docs = await getMissionDocuments(ctx, mission.id, input.companyId);
  const validationContract = parseMissionValidationContractDocument(docs.validationContract.body ?? "");
  const featurePlan = parseMissionFeaturesDocument(docs.features.body ?? "");
  const assertionIds = new Set(validationContract.assertions.map((assertion) => assertion.id));

  for (const milestone of featurePlan.milestones) {
    for (const dependencyId of milestone.depends_on) {
      if (!featurePlan.milestones.some((candidate) => candidate.id === dependencyId)) {
        throw new Error(`Milestone ${milestone.id} depends on unknown milestone ${dependencyId}`);
      }
    }

    for (const feature of milestone.features) {
      for (const assertionId of feature.claimed_assertion_ids) {
        if (!assertionIds.has(assertionId)) {
          throw new Error(`Feature ${feature.id} claims unknown validation assertion ${assertionId}`);
        }
      }

      for (const dependencyId of feature.depends_on) {
        const dependencyExists = featurePlan.milestones.some((candidateMilestone) =>
          candidateMilestone.features.some((candidateFeature) => candidateFeature.id === dependencyId),
        );
        if (!dependencyExists) {
          throw new Error(`Feature ${feature.id} depends on unknown feature ${dependencyId}`);
        }
      }
    }
  }

  const milestoneCount = featurePlan.milestones.length;
  const featureCount = featurePlan.milestones.reduce((count, milestone) => count + milestone.features.length, 0);
  const validationCount = featurePlan.milestones.length;

  const milestoneSpecs = featurePlan.milestones.map((milestone): GeneratedIssueSpec => ({
    kind: "milestone",
    key: milestone.id,
    title: `Mission milestone: ${milestone.title}`,
    description: buildMilestoneDescription({ mission, milestone, docs }),
    parentId: mission.id,
    originKind: generatedOriginKind(ctx, "milestone"),
    originId: milestoneOriginId(mission.id, milestone.id),
  }));

  const featureSpecs = featurePlan.milestones.flatMap((milestone) =>
    milestone.features.map((feature): GeneratedIssueSpec => ({
      kind: "feature",
      key: feature.id,
      title: `Mission feature: ${feature.title}`,
      description: buildFeatureDescription({ mission, milestone, feature, docs }),
      parentId: "",
      originKind: generatedOriginKind(ctx, "feature"),
      originId: featureOriginId(mission.id, feature.id),
    })),
  );

  const validationSpecs = featurePlan.milestones.map((milestone): GeneratedIssueSpec => ({
    kind: "validation",
    key: `${milestone.id}:validation`,
    title: `Mission validation: ${milestone.title}`,
    description: buildValidationDescription({ mission, milestone, docs }),
    parentId: "",
    originKind: generatedOriginKind(ctx, "validation"),
    originId: validationOriginId(mission.id, milestone.id),
  }));

  if (input.dryRun) {
    return {
      missionIssueId: mission.id,
      milestoneCount,
      featureCount,
      validationCount,
      createdIssueIds: [],
      updatedIssueIds: [],
      issues: [...milestoneSpecs, ...featureSpecs, ...validationSpecs].map((spec) => ({
        kind: spec.kind,
        key: spec.key,
        issueId: null,
        identifier: null,
        title: spec.title,
        created: false,
        blockedByIssueIds: [],
      })),
    };
  }

  const milestoneIssueIds = new Map<string, string>();
  const featureIssueIds = new Map<string, string>();
  const validationIssueIds = new Map<string, string>();
  const resultIssues: DecomposedIssueResult[] = [];
  const createdIssueIds: string[] = [];
  const updatedIssueIds: string[] = [];

  for (const spec of milestoneSpecs) {
    const { issue, created } = await upsertGeneratedIssue(ctx, mission, input.companyId, actor, spec);
    await recordLink(ctx, mission.id, spec, issue.id);
    milestoneIssueIds.set(spec.key, issue.id);
    if (created) createdIssueIds.push(issue.id);
    else updatedIssueIds.push(issue.id);
    resultIssues.push({
      kind: spec.kind,
      key: spec.key,
      issueId: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title,
      created,
      blockedByIssueIds: [],
    });
  }

  for (const milestone of featurePlan.milestones) {
    const parentId = milestoneIssueIds.get(milestone.id);
    if (!parentId) throw new Error(`Missing generated milestone issue for ${milestone.id}`);

    for (const feature of milestone.features) {
      const spec = featureSpecs.find((candidate) => candidate.key === feature.id);
      if (!spec) throw new Error(`Missing generated feature spec for ${feature.id}`);
      const { issue, created } = await upsertGeneratedIssue(
        ctx,
        mission,
        input.companyId,
        actor,
        { ...spec, parentId },
      );
      await recordLink(ctx, mission.id, { ...spec, parentId }, issue.id);
      featureIssueIds.set(feature.id, issue.id);
      if (created) createdIssueIds.push(issue.id);
      else updatedIssueIds.push(issue.id);
      resultIssues.push({
        kind: "feature",
        key: feature.id,
        issueId: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        created,
        blockedByIssueIds: [],
      });
    }

    const validationSpec = validationSpecs.find((candidate) => candidate.key === `${milestone.id}:validation`);
    if (!validationSpec) throw new Error(`Missing validation spec for ${milestone.id}`);
    const { issue, created } = await upsertGeneratedIssue(
      ctx,
      mission,
      input.companyId,
      actor,
      { ...validationSpec, parentId },
    );
    await recordLink(ctx, mission.id, { ...validationSpec, parentId }, issue.id);
    validationIssueIds.set(milestone.id, issue.id);
    if (created) createdIssueIds.push(issue.id);
    else updatedIssueIds.push(issue.id);
    resultIssues.push({
      kind: "validation",
      key: `${milestone.id}:validation`,
      issueId: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title,
      created,
      blockedByIssueIds: [],
    });
  }

  const blockersByIssueId = new Map<string, string[]>();

  for (const milestone of featurePlan.milestones) {
    const milestoneIssueId = milestoneIssueIds.get(milestone.id);
    const validationIssueId = validationIssueIds.get(milestone.id);
    if (!milestoneIssueId || !validationIssueId) {
      throw new Error(`Missing generated milestone or validation issue for ${milestone.id}`);
    }

    const dependencyValidationIds = milestone.depends_on
      .map((dependencyId) => validationIssueIds.get(dependencyId))
      .filter((value): value is string => Boolean(value));
    blockersByIssueId.set(milestoneIssueId, [...new Set([validationIssueId, ...dependencyValidationIds])]);

    const milestoneFeatureIds = milestone.features
      .map((feature) => featureIssueIds.get(feature.id))
      .filter((value): value is string => Boolean(value));
    blockersByIssueId.set(validationIssueId, [...new Set(milestoneFeatureIds)]);

    for (const feature of milestone.features) {
      const featureIssueId = featureIssueIds.get(feature.id);
      if (!featureIssueId) throw new Error(`Missing generated feature issue for ${feature.id}`);

      const dependencyFeatureIds = feature.depends_on
        .map((dependencyId) => featureIssueIds.get(dependencyId))
        .filter((value): value is string => Boolean(value));
      blockersByIssueId.set(featureIssueId, [...new Set([...dependencyFeatureIds, ...dependencyValidationIds])]);
    }
  }

  for (const resultIssue of resultIssues) {
    if (!resultIssue.issueId) continue;
    const blockedByIssueIds = blockersByIssueId.get(resultIssue.issueId) ?? [];
    await ctx.issues.relations.setBlockedBy(resultIssue.issueId, blockedByIssueIds, input.companyId, actor);
    await ctx.issues.update(
      resultIssue.issueId,
      { status: blockedByIssueIds.length > 0 ? "blocked" : "todo" },
      input.companyId,
      actor,
    );
    resultIssue.blockedByIssueIds = blockedByIssueIds;
  }

  if (createdIssueIds.length > 0) {
    const body = [
      "<!-- paperclip:plugin-missions:decompose -->",
      "Mission decomposition synced by the Missions plugin.",
      "",
      `- Created issues: ${createdIssueIds.length}`,
      `- Updated issues: ${updatedIssueIds.length}`,
      `- Milestones: ${milestoneCount}`,
      `- Features: ${featureCount}`,
      `- Validations: ${validationCount}`,
    ].join("\n");
    await ctx.issues.createComment(mission.id, body, input.companyId, {
      authorAgentId: actor.actorAgentId ?? undefined,
    });
  }

  return {
    missionIssueId: mission.id,
    milestoneCount,
    featureCount,
    validationCount,
    createdIssueIds,
    updatedIssueIds: [...new Set(updatedIssueIds.filter((issueId) => !createdIssueIds.includes(issueId)))],
    issues: resultIssues,
  };
}
