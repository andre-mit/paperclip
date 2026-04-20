import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Agent, Issue } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const PLUGIN_ORIGIN = `plugin:${manifest.id}` as const;

function issue(input: Partial<Issue> & Pick<Issue, "id" | "companyId" | "title">): Issue {
  const now = new Date();
  const { id, companyId, title, ...rest } = input;
  return {
    id,
    companyId,
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title,
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: null,
    identifier: null,
    originKind: "manual",
    originId: null,
    originRunId: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

function agent(input: Partial<Agent> & Pick<Agent, "id" | "companyId" | "name" | "status">): Agent {
  const now = new Date();
  const { id, companyId, name, status, ...rest } = input;
  return {
    id,
    companyId,
    name,
    urlKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    role: "engineer",
    title: null,
    icon: null,
    status,
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 100000,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

async function upsertMissionDocuments(
  harness: ReturnType<typeof createTestHarness>,
  companyId: string,
  issueId: string,
) {
  const docs = new Map<string, string>([
    ["plan", "# Mission Plan\n"],
    ["mission-brief", "# Mission Brief\n"],
    [
      "validation-contract",
      JSON.stringify(
        {
          assertions: [
            {
              id: "VAL-MISSION-001",
              title: "Mission validation",
              user_value: "Advance loop works",
              scope: "Mission runtime",
              setup: "Plugin test harness",
              steps: ["Advance the mission"],
              oracle: "Only valid issues are woken",
              tooling: ["manual_review"],
              evidence: [{ kind: "primary", description: "Mission summary", required: true }],
              claimed_by: ["FEAT-MISSION-001"],
              status: "unclaimed",
            },
          ],
        },
        null,
        2,
      ),
    ],
    [
      "features",
      JSON.stringify(
        {
          milestones: [
            {
              id: "MILESTONE-MISSION-001",
              title: "Core Mission Flow",
              summary: "Advance and validation loop",
              features: [
                {
                  id: "FEAT-MISSION-001",
                  title: "Advance mission",
                  kind: "original",
                  summary: "Drive assigned work forward",
                  acceptance_criteria: ["Wake assigned and unblocked work"],
                  claimed_assertion_ids: ["VAL-MISSION-001"],
                  status: "planned",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    ],
    ["worker-guidelines", "# Worker Guidelines\n"],
    ["services", "# Services\n"],
    ["knowledge-base", "# Knowledge Base\n"],
    ["decision-log", "# Decision Log\n"],
  ]);

  for (const [key, body] of docs) {
    await harness.ctx.issues.documents.upsert({
      issueId,
      companyId,
      key,
      title: key,
      body,
      changeSummary: `Seeded ${key}`,
    });
  }
}

describe("missions plugin package", () => {
  it("declares mission initialization surfaces", () => {
    expect(manifest).toMatchObject({
      id: "paperclip.missions",
      database: {
        namespaceSlug: "missions",
        migrationsDir: "migrations",
        coreReadTables: ["issues"],
      },
    });
    expect(manifest.apiRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeKey: "initialize-mission", path: "/issues/:issueId/missions/init" }),
        expect.objectContaining({ routeKey: "mission-summary", path: "/issues/:issueId/missions/summary" }),
      ]),
    );
    expect(manifest.ui?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "page", exportName: "MissionsPage" }),
        expect.objectContaining({ type: "taskDetailView", exportName: "MissionIssuePanel" }),
        expect.objectContaining({ type: "toolbarButton", exportName: "MissionToolbarButton" }),
      ]),
    );
  });

  it("initializes a root mission, creates required documents, and returns a draft summary", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Initialize the mission root",
          identifier: "TST-1",
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<{
      created: boolean;
      createdDocumentKeys: string[];
      summary: {
        isMission: boolean;
        state: string | null;
        persistence: { hasRootLink: boolean; hasInitializationEvent: boolean } | null;
      };
    }>("initialize-mission", {
      companyId,
      issueId: rootIssueId,
    });

    expect(result.created).toBe(true);
    expect(result.createdDocumentKeys).toHaveLength(8);
    expect(result.summary).toMatchObject({
      isMission: true,
      state: "draft",
      persistence: {
        hasRootLink: true,
        hasInitializationEvent: true,
      },
    });

    const rootIssue = await harness.ctx.issues.get(rootIssueId, companyId);
    expect(rootIssue).toMatchObject({
      originKind: "plugin:paperclip.missions",
      originId: `mission:${rootIssueId}`,
      billingCode: `mission:${rootIssueId}`,
    });

    const docs = await harness.ctx.issues.documents.list(rootIssueId, companyId);
    expect(new Set(docs.map((document) => document.key))).toEqual(
      new Set([
        "plan",
        "mission-brief",
        "validation-contract",
        "features",
        "worker-guidelines",
        "services",
        "knowledge-base",
        "decision-log",
      ]),
    );

    expect(harness.dbExecutes.some((entry) => entry.sql.includes(".missions"))).toBe(true);
    expect(harness.dbExecutes.some((entry) => entry.sql.includes(".mission_issue_links"))).toBe(true);
    expect(harness.dbExecutes.some((entry) => entry.sql.includes(".mission_events"))).toBe(true);
  });

  it("keeps initialization idempotent and surfaces parse errors in the summary", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Mission with parser errors",
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);

    await harness.performAction("initialize-mission", { companyId, issueId: rootIssueId });
    const second = await harness.performAction<{
      created: boolean;
      createdDocumentKeys: string[];
      summary: { isMission: boolean; state: string | null };
    }>("initialize-mission", { companyId, issueId: rootIssueId });
    expect(second.created).toBe(false);
    expect(second.createdDocumentKeys).toEqual([]);
    expect(second.summary).toMatchObject({
      isMission: true,
      state: "draft",
    });

    await harness.ctx.issues.documents.upsert({
      issueId: rootIssueId,
      companyId,
      key: "validation-contract",
      title: "Validation Contract",
      body: "{ not-valid-json }",
    });
    const summary = await harness.getData<{
      isMission: boolean;
      parseProblems: Array<{ key: string }>;
    }>("mission-summary", {
      companyId,
      issueId: rootIssueId,
    });
    expect(summary.isMission).toBe(true);
    expect(summary.parseProblems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "validation-contract" }),
      ]),
    );
  });

  it("decomposes mission documents into an idempotent issue tree with blocker relations", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const executionWorkspaceSettings = { mode: "reuse_existing" } as const;
    const harness = createTestHarness({ manifest });
    harness.seed({
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Mission root",
          identifier: "TST-42",
          billingCode: "missions:root",
          projectId: randomUUID(),
          goalId: randomUUID(),
          executionWorkspaceId,
          executionWorkspacePreference: "reuse_existing",
          executionWorkspaceSettings,
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);
    await upsertMissionDocuments(harness, companyId, rootIssueId);

    await harness.ctx.issues.documents.upsert({
      issueId: rootIssueId,
      companyId,
      key: "validation-contract",
      title: "Validation Contract",
      body: JSON.stringify(
        {
          assertions: [
            {
              id: "VAL-MISSION-001",
              title: "Foundation works",
              user_value: "Foundation milestone works",
              scope: "Foundation milestone",
              setup: "Mission harness",
              steps: ["Finish the foundation feature"],
              oracle: "Foundation feature passes validation",
              tooling: ["manual_review"],
              evidence: [{ kind: "primary", description: "Foundation validation", required: true }],
              claimed_by: ["FEAT-MISSION-001"],
              status: "claimed",
            },
            {
              id: "VAL-MISSION-002",
              title: "Rollout works",
              user_value: "Rollout milestone works",
              scope: "Rollout milestone",
              setup: "Mission harness",
              steps: ["Finish the rollout feature"],
              oracle: "Rollout feature passes validation",
              tooling: ["manual_review"],
              evidence: [{ kind: "primary", description: "Rollout validation", required: true }],
              claimed_by: ["FEAT-MISSION-002"],
              status: "claimed",
            },
          ],
        },
        null,
        2,
      ),
      changeSummary: "Seeded decomposition validation contract",
    });
    await harness.ctx.issues.documents.upsert({
      issueId: rootIssueId,
      companyId,
      key: "features",
      title: "Features",
      body: JSON.stringify(
        {
          milestones: [
            {
              id: "MILESTONE-MISSION-001",
              title: "Foundation",
              summary: "Create the base mission workflow",
              depends_on: [],
              features: [
                {
                  id: "FEAT-MISSION-001",
                  title: "Seed mission tree",
                  kind: "original",
                  summary: "Create the first generated issues",
                  acceptance_criteria: ["Create milestone, feature, and validation issues"],
                  claimed_assertion_ids: ["VAL-MISSION-001"],
                  depends_on: [],
                  status: "planned",
                },
              ],
            },
            {
              id: "MILESTONE-MISSION-002",
              title: "Rollout",
              summary: "Advance work after foundation validation",
              depends_on: ["MILESTONE-MISSION-001"],
              features: [
                {
                  id: "FEAT-MISSION-002",
                  title: "Ship decomposition",
                  kind: "original",
                  summary: "Create the dependent rollout issue",
                  acceptance_criteria: ["Rollout waits for foundation validation"],
                  claimed_assertion_ids: ["VAL-MISSION-002"],
                  depends_on: ["FEAT-MISSION-001"],
                  status: "planned",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      changeSummary: "Seeded decomposition feature plan",
    });

    const first = await harness.performAction<{
      milestoneCount: number;
      featureCount: number;
      validationCount: number;
      createdIssueIds: string[];
      updatedIssueIds: string[];
      issues: Array<{ key: string; issueId: string; created: boolean; blockedByIssueIds: string[] }>;
    }>("decompose-mission", {
      companyId,
      issueId: rootIssueId,
    });
    const second = await harness.performAction<{
      createdIssueIds: string[];
      updatedIssueIds: string[];
      issues: Array<{ key: string; issueId: string; created: boolean; blockedByIssueIds: string[] }>;
    }>("decompose-mission", {
      companyId,
      issueId: rootIssueId,
    });

    expect(first).toMatchObject({
      milestoneCount: 2,
      featureCount: 2,
      validationCount: 2,
    });
    expect(first.createdIssueIds).toHaveLength(6);
    expect(first.updatedIssueIds).toEqual([]);
    expect(second.createdIssueIds).toEqual([]);
    expect(second.updatedIssueIds).toHaveLength(6);
    expect(new Set(second.issues.map((entry) => entry.issueId))).toEqual(new Set(first.createdIssueIds));

    const milestone1 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:milestone`,
        originId: `${rootIssueId}:milestone:MILESTONE-MISSION-001`,
      })
    )[0];
    const milestone2 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:milestone`,
        originId: `${rootIssueId}:milestone:MILESTONE-MISSION-002`,
      })
    )[0];
    const feature1 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:feature`,
        originId: `${rootIssueId}:feature:FEAT-MISSION-001`,
      })
    )[0];
    const feature2 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:feature`,
        originId: `${rootIssueId}:feature:FEAT-MISSION-002`,
      })
    )[0];
    const validation1 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:validation`,
        originId: `${rootIssueId}:validation:MILESTONE-MISSION-001`,
      })
    )[0];
    const validation2 = (
      await harness.ctx.issues.list({
        companyId,
        originKind: `${PLUGIN_ORIGIN}:validation`,
        originId: `${rootIssueId}:validation:MILESTONE-MISSION-002`,
      })
    )[0];

    expect([milestone1, milestone2, feature1, feature2, validation1, validation2]).toHaveLength(6);

    for (const generatedIssue of [milestone1, milestone2, feature1, feature2, validation1, validation2]) {
      expect(generatedIssue).toMatchObject({
        billingCode: "missions:root",
        executionWorkspaceId,
        executionWorkspacePreference: "reuse_existing",
        executionWorkspaceSettings,
      });
    }

    expect(milestone1).toMatchObject({
      parentId: rootIssueId,
      status: "blocked",
    });
    expect(milestone2).toMatchObject({
      parentId: rootIssueId,
      status: "blocked",
    });
    expect(feature1).toMatchObject({
      parentId: milestone1?.id,
      status: "todo",
    });
    expect(feature2).toMatchObject({
      parentId: milestone2?.id,
      status: "blocked",
    });
    expect(validation1).toMatchObject({
      parentId: milestone1?.id,
      status: "blocked",
    });
    expect(validation2).toMatchObject({
      parentId: milestone2?.id,
      status: "blocked",
    });

    expect(await harness.ctx.issues.relations.get(feature1!.id, companyId)).toMatchObject({
      blockedBy: [],
    });
    expect(await harness.ctx.issues.relations.get(validation1!.id, companyId)).toMatchObject({
      blockedBy: [expect.objectContaining({ id: feature1!.id })],
    });
    expect(await harness.ctx.issues.relations.get(milestone1!.id, companyId)).toMatchObject({
      blockedBy: [expect.objectContaining({ id: validation1!.id })],
    });
    expect(await harness.ctx.issues.relations.get(feature2!.id, companyId)).toMatchObject({
      blockedBy: expect.arrayContaining([
        expect.objectContaining({ id: feature1!.id }),
        expect.objectContaining({ id: validation1!.id }),
      ]),
    });
    expect(await harness.ctx.issues.relations.get(validation2!.id, companyId)).toMatchObject({
      blockedBy: [expect.objectContaining({ id: feature2!.id })],
    });
    expect(await harness.ctx.issues.relations.get(milestone2!.id, companyId)).toMatchObject({
      blockedBy: expect.arrayContaining([
        expect.objectContaining({ id: validation1!.id }),
        expect.objectContaining({ id: validation2!.id }),
      ]),
    });

    expect(harness.dbExecutes.some((entry) => entry.sql.includes(".mission_issue_links"))).toBe(true);
  });

  it("wakes assigned unblocked work and creates a single fix issue for blocking findings", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const readyFeatureId = randomUUID();
    const validationIssueId = randomUUID();
    const agentId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [agent({ id: agentId, companyId, name: "Worker", status: "active" })],
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Mission root",
          assigneeAgentId: agentId,
          originKind: PLUGIN_ORIGIN,
        }),
        issue({
          id: readyFeatureId,
          companyId,
          parentId: rootIssueId,
          title: "Ready feature",
          assigneeAgentId: agentId,
          originKind: `${PLUGIN_ORIGIN}:feature`,
          originId: "FEAT-MISSION-001",
        }),
        issue({
          id: validationIssueId,
          companyId,
          parentId: rootIssueId,
          title: "Validation round",
          status: "done",
          assigneeAgentId: agentId,
          originKind: `${PLUGIN_ORIGIN}:validation`,
          originId: "VAL-ROUND-001",
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);
    await upsertMissionDocuments(harness, companyId, rootIssueId);
    await harness.ctx.issues.documents.upsert({
      issueId: validationIssueId,
      companyId,
      key: "validation-report-round-1",
      title: "Validation Report Round 1",
      body: JSON.stringify({
        round: 1,
        validator_role: "scrutiny_validator",
        summary: "Found one blocking issue",
        findings: [
          {
            id: "FINDING-MISSION-001",
            severity: "blocking",
            assertion_id: "VAL-MISSION-001",
            title: "Advance skips fix loop",
            evidence: ["Validation report"],
            repro_steps: ["Run advance mission"],
            expected: "Blocking findings create one fix issue",
            actual: "No fix issue existed",
            status: "open",
          },
        ],
      }),
      changeSummary: "Seeded validation findings",
    });

    const firstAdvance = await harness.performAction<{
      outcome: string;
      createdFixIssueIds: string[];
      wokenIssueIds: string[];
    }>("advance-mission", {
      companyId,
      issueId: rootIssueId,
      actorAgentId: agentId,
      actorRunId: "run_1",
    });
    const secondAdvance = await harness.performAction<{ createdFixIssueIds: string[] }>("advance-mission", {
      companyId,
      issueId: rootIssueId,
      actorAgentId: agentId,
      actorRunId: "run_2",
    });

    const fixIssues = await harness.ctx.issues.list({
      companyId,
      originKind: `${PLUGIN_ORIGIN}:fix`,
    });

    expect(firstAdvance.outcome).toBe("woke_issues");
    expect(firstAdvance.wokenIssueIds).toEqual(expect.arrayContaining([readyFeatureId]));
    expect(firstAdvance.createdFixIssueIds).toHaveLength(1);
    expect(secondAdvance.createdFixIssueIds).toEqual(firstAdvance.createdFixIssueIds);
    expect(fixIssues).toHaveLength(1);
  });

  it("requires waiver rationale and records approved waivers", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const validationIssueId = randomUUID();
    const agentId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      agents: [agent({ id: agentId, companyId, name: "Worker", status: "active" })],
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Mission root",
          assigneeAgentId: agentId,
          originKind: PLUGIN_ORIGIN,
        }),
        issue({
          id: validationIssueId,
          companyId,
          parentId: rootIssueId,
          title: "Validation round",
          status: "done",
          assigneeAgentId: agentId,
          originKind: `${PLUGIN_ORIGIN}:validation`,
          originId: "VAL-ROUND-001",
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);
    await upsertMissionDocuments(harness, companyId, rootIssueId);
    await harness.ctx.issues.documents.upsert({
      issueId: validationIssueId,
      companyId,
      key: "validation-report-round-1",
      title: "Validation Report Round 1",
      body: JSON.stringify({
        round: 1,
        validator_role: "scrutiny_validator",
        summary: "Found one blocking issue",
        findings: [
          {
            id: "FINDING-MISSION-001",
            severity: "blocking",
            assertion_id: "VAL-MISSION-001",
            title: "Advance skips fix loop",
            evidence: ["Validation report"],
            repro_steps: ["Run advance mission"],
            expected: "Blocking findings create one fix issue",
            actual: "No fix issue existed",
            status: "open",
          },
        ],
      }),
      changeSummary: "Seeded validation findings",
    });

    await expect(
      plugin.definition.onApiRequest?.({
        routeKey: "waive-mission-finding",
        method: "POST",
        path: `/issues/${rootIssueId}/missions/findings/FINDING-MISSION-001/waive`,
        params: { issueId: rootIssueId, findingKey: "FINDING-MISSION-001" },
        query: {},
        body: {},
        actor: {
          actorType: "user",
          actorId: "board",
          userId: "board",
          agentId: null,
          runId: null,
        },
        companyId,
        headers: {},
      }),
    ).resolves.toMatchObject({
      status: 422,
      body: { error: "rationale is required" },
    });

    await expect(
      plugin.definition.onApiRequest?.({
        routeKey: "waive-mission-finding",
        method: "POST",
        path: `/issues/${rootIssueId}/missions/findings/FINDING-MISSION-001/waive`,
        params: { issueId: rootIssueId, findingKey: "FINDING-MISSION-001" },
        query: {},
        body: { rationale: "Known acceptable risk for this mission" },
        actor: {
          actorType: "user",
          actorId: "board",
          userId: "board",
          agentId: null,
          runId: null,
        },
        companyId,
        headers: {},
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: expect.objectContaining({
        waived: true,
        findingId: "FINDING-MISSION-001",
      }),
    });
  });

  it("enforces checkout ownership for agent-triggered initialization on in-progress issues", async () => {
    const companyId = randomUUID();
    const rootIssueId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const harness = createTestHarness({ manifest });
    harness.seed({
      issues: [
        issue({
          id: rootIssueId,
          companyId,
          title: "Checked out mission root",
          status: "in_progress",
          assigneeAgentId: agentId,
          checkoutRunId: runId,
        }),
      ],
    });
    await plugin.definition.setup(harness.ctx);

    await expect(
      plugin.definition.onApiRequest?.({
        routeKey: "initialize-mission",
        method: "POST",
        path: `/issues/${rootIssueId}/missions/init`,
        params: { issueId: rootIssueId },
        query: {},
        body: {},
        actor: {
          actorType: "agent",
          actorId: agentId,
          agentId,
          userId: null,
          runId: randomUUID(),
        },
        companyId,
        headers: {},
      }),
    ).rejects.toThrow("Issue run ownership conflict");
  });
});
