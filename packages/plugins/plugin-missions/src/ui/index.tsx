import {
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginHostContext,
  type PluginPageProps,
  type PluginSettingsPageProps,
} from "@paperclipai/plugin-sdk/ui";
import type React from "react";
import { useState } from "react";
import type { MissionInitializationResult, MissionIssueSummary } from "../mission-initialization.js";

type EntitySlotProps = {
  context: PluginHostContext & {
    entityId: string;
    entityType: string;
  };
};

type SurfaceStatus = {
  status: "ok";
  checkedAt: string;
  companyId: string | null;
  databaseNamespace: string;
  routeKeys: string[];
  uiSlotIds: string[];
  pluginId: string;
  message: string;
};

type MissionsList = {
  companyId: string;
  missions: Array<{
    issueId: string;
    identifier: string | null;
    title: string;
    status: string;
  }>;
  routeKeys: string[];
  pageRoute: string;
  message: string;
};

const panelStyle = {
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  background: "#ffffff",
  color: "#111827",
} satisfies React.CSSProperties;

const gridStyle = {
  display: "grid",
  gap: 8,
} satisfies React.CSSProperties;

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
} satisfies React.CSSProperties;

const buttonStyle = {
  border: "1px solid #111827",
  background: "#111827",
  color: "#ffffff",
  borderRadius: 6,
  padding: "6px 10px",
  font: "inherit",
  cursor: "pointer",
} satisfies React.CSSProperties;

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#ffffff",
  color: "#111827",
} satisfies React.CSSProperties;

function SummaryRows({ data }: { data: MissionIssueSummary }) {
  return (
    <div style={gridStyle}>
      <div style={rowStyle}><span>State</span><strong>{data.state ?? "not-initialized"}</strong></div>
      <div style={rowStyle}><span>Billing</span><code>{data.settings.billingCode ?? "unset"}</code></div>
      <div style={rowStyle}><span>Namespace</span><code>{data.settings.databaseNamespace}</code></div>
      <div style={rowStyle}><span>Open Findings</span><strong>{data.openFindingCount}</strong></div>
    </div>
  );
}

function Checklist({ data }: { data: MissionIssueSummary }) {
  return (
    <div style={gridStyle}>
      {data.documentChecklist.map((item) => (
        <div key={item.key} style={rowStyle}>
          <code>{item.key}</code>
          <strong>{item.present ? item.title ?? "present" : "missing"}</strong>
        </div>
      ))}
    </div>
  );
}

function InitializeMissionButton({
  companyId,
  issueId,
  disabledReason,
  onDone,
}: {
  companyId: string;
  issueId: string;
  disabledReason: string | null;
  onDone?: (result: MissionInitializationResult) => Promise<void> | void;
}) {
  const initializeMission = usePluginAction("initialize-mission");
  const toast = usePluginToast();
  const [pending, setPending] = useState(false);

  return (
    <button
      style={buttonStyle}
      type="button"
      disabled={pending || Boolean(disabledReason)}
      title={disabledReason ?? undefined}
      onClick={async () => {
        setPending(true);
        try {
          const result = await initializeMission({ companyId, issueId }) as MissionInitializationResult;
          toast({
            title: result.created ? "Mission initialized" : "Mission already initialized",
            body: result.summary.nextAction,
            tone: "success",
          });
          await onDone?.(result);
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Initializing..." : "Init Mission"}
    </button>
  );
}

export function MissionsPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const { data, loading, error, refresh } = usePluginData<MissionsList>("missions-list", {
    companyId,
  });

  if (!companyId) return <div style={panelStyle}>Open a company to view missions.</div>;
  if (loading) return <div style={panelStyle}>Loading missions...</div>;
  if (error) return <div style={panelStyle}>Missions page error: {error.message}</div>;
  if (!data) return null;

  return (
    <div style={panelStyle}>
      <div style={rowStyle}>
        <strong>Missions</strong>
        <button style={secondaryButtonStyle} type="button" onClick={() => refresh()}>
          Refresh
        </button>
      </div>
      <div>{data.message}</div>
      {data.missions.length === 0 ? (
        <div>No root mission issues have been initialized yet.</div>
      ) : (
        <div style={gridStyle}>
          {data.missions.map((mission) => (
            <div key={mission.issueId} style={{ ...rowStyle, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
              <span>{mission.identifier ?? mission.issueId}</span>
              <strong>{mission.status}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MissionIssuePanel({ context }: EntitySlotProps) {
  const { data, loading, error, refresh } = usePluginData<MissionIssueSummary>("mission-summary", {
    companyId: context.companyId,
    issueId: context.entityId,
  });

  if (!context.companyId || !context.entityId) {
    return <div style={panelStyle}>Mission controls need an issue context.</div>;
  }
  if (loading) return <div style={panelStyle}>Loading mission summary...</div>;
  if (error) return <div style={panelStyle}>Mission panel error: {error.message}</div>;
  if (!data) return null;

  if (!data.isMission) {
    return (
      <div style={panelStyle}>
        <strong>Mission</strong>
        <div>This issue has not been initialized as a mission yet.</div>
        <div>{data.nextAction}</div>
        <InitializeMissionButton
          companyId={context.companyId}
          issueId={context.entityId}
          disabledReason={data.initializeDisabledReason}
          onDone={async () => {
            await refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={rowStyle}>
        <strong>Mission</strong>
        <button style={secondaryButtonStyle} type="button" onClick={() => refresh()}>
          Refresh
        </button>
      </div>
      <SummaryRows data={data} />
      <div><strong>Next action:</strong> {data.nextAction}</div>
      <Checklist data={data} />
      {data.parseProblems.length > 0 ? (
        <div style={gridStyle}>
          {data.parseProblems.map((problem) => (
            <div key={`${problem.key}:${problem.message}`} style={{ color: "#b45309" }}>
              <code>{problem.key}</code>: {problem.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MissionToolbarButton({ context }: EntitySlotProps) {
  const { data, loading, refresh } = usePluginData<MissionIssueSummary>("mission-summary", {
    companyId: context.companyId,
    issueId: context.entityId,
  });

  if (!context.companyId || !context.entityId || loading || !data || data.isMission) return null;

  return (
    <InitializeMissionButton
      companyId={context.companyId}
      issueId={context.entityId}
      disabledReason={data.initializeDisabledReason}
      onDone={async () => {
        await refresh();
      }}
    />
  );
}

export function MissionsSettingsPage({ context }: PluginSettingsPageProps) {
  const { data, loading, error } = usePluginData<SurfaceStatus>("surface-status", {
    ...(context.companyId ? { companyId: context.companyId } : {}),
  });

  if (loading) return <div style={panelStyle}>Loading missions settings...</div>;
  if (error) return <div style={panelStyle}>Missions settings error: {error.message}</div>;
  if (!data) return null;

  return (
    <div style={panelStyle}>
      <strong>Missions Settings Surface</strong>
      <div style={gridStyle}>
        <div style={rowStyle}><span>Plugin</span><code>{data.pluginId}</code></div>
        <div style={rowStyle}><span>Namespace</span><code>{data.databaseNamespace}</code></div>
        <div style={rowStyle}><span>Routes</span><strong>{data.routeKeys.length}</strong></div>
        <div style={rowStyle}><span>UI Slots</span><strong>{data.uiSlotIds.length}</strong></div>
      </div>
      <div>{data.message}</div>
    </div>
  );
}
