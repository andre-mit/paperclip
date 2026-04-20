import { describe, expect, it } from "vitest";
import {
  buildPreRunHydrateTrace,
  buildSkippedMemoryHookTrace,
  formatMemoryHookTraceLog,
} from "../services/memory-hook-trace.js";

describe("memory hook trace logs", () => {
  it("formats hydrated records with binding, provider, operation, and record ids", () => {
    const trace = buildPreRunHydrateTrace(
      {
        id: "binding-1",
        key: "company-default",
        providerKey: "local_basic",
      },
      {
        preamble: "Use the deployment notes.",
        operation: {
          id: "operation-1",
          operationType: "query",
          status: "succeeded",
        },
        records: [
          {
            id: "record-1",
            title: "Deployment notes",
            source: { kind: "issue_document", issueId: "issue-1", documentKey: "plan" },
            citation: { label: "Issue document", sourceTitle: "Plan" },
          },
        ],
      } as any,
    );

    expect(formatMemoryHookTraceLog(trace)).toBe(
      "[paperclip:memory] pre-run hydrate hydrated; 1 record; binding=company-default; provider=local_basic; operation=operation-1; preambleBytes=25; records=record-1 (Deployment notes)\n",
    );
  });

  it("formats skipped hook decisions with an explicit reason", () => {
    const trace = buildSkippedMemoryHookTrace({
      hookKind: "post_run_capture",
      reason: "no_run_summary",
    });

    expect(formatMemoryHookTraceLog(trace)).toBe(
      "[paperclip:memory] post-run capture skipped; 0 records; reason=no_run_summary\n",
    );
  });
});
