import { definePlugin, runWorker, type PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { decomposeMission, type MissionDecompositionResult } from "./decompose.js";
import { initializeMission, type MissionInitializationResult } from "./mission-initialization.js";
import {
  advanceMission,
  buildMissionSummary,
  waiveMissionFinding,
  type MissionAdvanceResult,
  type MissionSummary,
  type MissionWaiveFindingResult,
} from "./mission-runtime.js";
import manifest, { MISSIONS_API_ROUTE_KEYS, MISSIONS_UI_SLOT_IDS } from "./manifest.js";

const PLUGIN_ORIGIN = `plugin:${manifest.id}` as const;

type InitializeInput = {
  companyId: string;
  issueId: string;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type DecomposeInput = {
  companyId: string;
  issueId: string;
  dryRun?: boolean;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type AdvanceInput = {
  companyId: string;
  issueId: string;
  maxValidationRounds?: number;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type WaiveInput = {
  companyId: string;
  issueId: string;
  findingId: string;
  rationale: string;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
};

type SurfaceStatus = {
  status: "ok";
  checkedAt: string;
  companyId: string | null;
  databaseNamespace: string;
  routeKeys: string[];
  uiSlotIds: string[];
  pluginId: string;
};

type MissionsList = {
  status: "ok";
  companyId: string;
  missions: Array<{
    issueId: string;
    identifier: string | null;
    title: string;
    status: string;
  }>;
};

let runInitialize: ((input: InitializeInput) => Promise<MissionInitializationResult>) | null = null;
let runDecompose: ((input: DecomposeInput) => Promise<MissionDecompositionResult>) | null = null;
let loadMissionSummary: ((companyId: string, issueId: string) => Promise<MissionSummary>) | null = null;
let runAdvance: ((input: AdvanceInput) => Promise<MissionAdvanceResult>) | null = null;
let runWaive: ((input: WaiveInput) => Promise<MissionWaiveFindingResult>) | null = null;
let listMissions: ((companyId: string) => Promise<MissionsList>) | null = null;

function stringField(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanField(value: unknown) {
  return value === true || value === "true";
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const plugin = definePlugin({
  async setup(ctx) {
    runInitialize = async (input: InitializeInput) =>
      initializeMission(ctx, {
        companyId: input.companyId,
        issueId: input.issueId,
        actorAgentId: input.actorAgentId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRunId: input.actorRunId ?? null,
      });

    runDecompose = async (input: DecomposeInput) =>
      decomposeMission(ctx, {
        companyId: input.companyId,
        issueId: input.issueId,
        dryRun: input.dryRun,
        actor: {
          actorAgentId: input.actorAgentId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorRunId: input.actorRunId ?? null,
        },
      });

    loadMissionSummary = async (companyId: string, issueId: string) => buildMissionSummary(ctx, companyId, issueId);

    runAdvance = async (input: AdvanceInput) =>
      advanceMission(ctx, {
        companyId: input.companyId,
        issueId: input.issueId,
        maxValidationRounds: input.maxValidationRounds,
        actorAgentId: input.actorAgentId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRunId: input.actorRunId ?? null,
      });

    runWaive = async (input: WaiveInput) =>
      waiveMissionFinding(ctx, {
        companyId: input.companyId,
        issueId: input.issueId,
        findingId: input.findingId,
        rationale: input.rationale,
        actorAgentId: input.actorAgentId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRunId: input.actorRunId ?? null,
      });

    listMissions = async (companyId: string) => {
      const issues = await ctx.issues.list({
        companyId,
        originKind: PLUGIN_ORIGIN,
      });
      return {
        status: "ok",
        companyId,
        missions: issues.map((issue) => ({
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status,
        })),
      };
    };

    ctx.data.register("surface-status", async (params) => ({
      status: "ok",
      checkedAt: new Date().toISOString(),
      companyId: stringField(params.companyId),
      databaseNamespace: ctx.db.namespace,
      routeKeys: [...MISSIONS_API_ROUTE_KEYS],
      uiSlotIds: [...MISSIONS_UI_SLOT_IDS],
      pluginId: manifest.id,
    } satisfies SurfaceStatus));

    ctx.data.register("mission-summary", async (params) => {
      const companyId = stringField(params.companyId);
      const issueId = stringField(params.issueId);
      if (!companyId || !issueId) throw new Error("companyId and issueId are required");
      if (!loadMissionSummary) throw new Error("Mission summary is not ready");
      return loadMissionSummary(companyId, issueId);
    });

    ctx.data.register("missions-list", async (params) => {
      const companyId = stringField(params.companyId);
      if (!companyId) throw new Error("companyId is required");
      if (!listMissions) throw new Error("Mission list is not ready");
      return listMissions(companyId);
    });

    ctx.actions.register("initialize-mission", async (params) => {
      const companyId = stringField(params.companyId);
      const issueId = stringField(params.issueId);
      if (!companyId || !issueId) throw new Error("companyId and issueId are required");
      if (!runInitialize) throw new Error("Mission initialization is not ready");
      return runInitialize({
        companyId,
        issueId,
        actorAgentId: stringField(params.actorAgentId),
        actorUserId: stringField(params.actorUserId),
        actorRunId: stringField(params.actorRunId),
      });
    });

    ctx.actions.register("decompose-mission", async (params) => {
      const companyId = stringField(params.companyId);
      const issueId = stringField(params.issueId);
      if (!companyId || !issueId) throw new Error("companyId and issueId are required");
      if (!runDecompose) throw new Error("Mission decomposition is not ready");
      return runDecompose({
        companyId,
        issueId,
        dryRun: booleanField(params.dryRun),
        actorAgentId: stringField(params.actorAgentId),
        actorUserId: stringField(params.actorUserId),
        actorRunId: stringField(params.actorRunId),
      });
    });

    ctx.actions.register("advance-mission", async (params) => {
      const companyId = stringField(params.companyId);
      const issueId = stringField(params.issueId);
      if (!companyId || !issueId) throw new Error("companyId and issueId are required");
      if (!runAdvance) throw new Error("Mission advance is not ready");
      return runAdvance({
        companyId,
        issueId,
        maxValidationRounds: numberField(params.maxValidationRounds),
        actorAgentId: stringField(params.actorAgentId),
        actorUserId: stringField(params.actorUserId),
        actorRunId: stringField(params.actorRunId),
      });
    });

    ctx.actions.register("waive-mission-finding", async (params) => {
      const companyId = stringField(params.companyId);
      const issueId = stringField(params.issueId);
      const findingId = stringField(params.findingId) ?? stringField(params.findingKey);
      const rationale = stringField(params.rationale);
      if (!companyId || !issueId || !findingId || !rationale) {
        throw new Error("companyId, issueId, findingId, and rationale are required");
      }
      if (!runWaive) throw new Error("Mission waiver flow is not ready");
      return runWaive({
        companyId,
        issueId,
        findingId,
        rationale,
        actorAgentId: stringField(params.actorAgentId),
        actorUserId: stringField(params.actorUserId),
        actorRunId: stringField(params.actorRunId),
      });
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    if (input.routeKey === "initialize-mission") {
      if (!runInitialize) throw new Error("Mission initialization is not ready");
      const result = await runInitialize({
        companyId: input.companyId,
        issueId: input.params.issueId,
        actorAgentId: input.actor.agentId ?? null,
        actorUserId: input.actor.userId ?? null,
        actorRunId: input.actor.runId ?? null,
      });
      return {
        status: result.created ? 201 : 200,
        body: result,
      };
    }

    if (input.routeKey === "mission-summary") {
      if (!loadMissionSummary) throw new Error("Mission summary is not ready");
      return {
        status: 200,
        body: await loadMissionSummary(input.companyId, input.params.issueId),
      };
    }

    if (input.routeKey === "decompose-mission") {
      if (!runDecompose) throw new Error("Mission decomposition is not ready");
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 200,
        body: await runDecompose({
          companyId: input.companyId,
          issueId: input.params.issueId,
          dryRun: booleanField(body?.dryRun),
          actorAgentId: input.actor.agentId ?? null,
          actorUserId: input.actor.userId ?? null,
          actorRunId: input.actor.runId ?? null,
        }),
      };
    }

    if (input.routeKey === "advance-mission") {
      if (!runAdvance) throw new Error("Mission advance is not ready");
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 200,
        body: await runAdvance({
          companyId: input.companyId,
          issueId: input.params.issueId,
          maxValidationRounds: numberField(body?.maxValidationRounds),
          actorAgentId: input.actor.agentId ?? null,
          actorUserId: input.actor.userId ?? null,
          actorRunId: input.actor.runId ?? null,
        }),
      };
    }

    if (input.routeKey === "waive-mission-finding") {
      if (!runWaive) throw new Error("Mission waiver flow is not ready");
      const body = input.body as Record<string, unknown> | null;
      const rationale = stringField(body?.rationale);
      const findingId = input.params.findingKey ?? input.params.findingId;
      if (!rationale) {
        return {
          status: 422,
          body: { error: "rationale is required" },
        };
      }
      return {
        status: 200,
        body: await runWaive({
          companyId: input.companyId,
          issueId: input.params.issueId,
          findingId,
          rationale,
          actorAgentId: input.actor.agentId ?? null,
          actorUserId: input.actor.userId ?? null,
          actorRunId: input.actor.runId ?? null,
        }),
      };
    }

    if (input.routeKey === "missions-list") {
      if (!listMissions) throw new Error("Mission list is not ready");
      return {
        status: 200,
        body: await listMissions(input.companyId),
      };
    }

    return {
      status: 404,
      body: { error: `Unknown missions route: ${input.routeKey}` },
    };
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Missions plugin worker is running",
      details: {
        routeKeys: [...MISSIONS_API_ROUTE_KEYS],
        uiSlotIds: [...MISSIONS_UI_SLOT_IDS],
      },
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
