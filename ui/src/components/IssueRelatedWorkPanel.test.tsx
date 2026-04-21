import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IssueRelatedWorkPanel } from "./IssueRelatedWorkPanel";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => <a href={to} {...props}>{children}</a>,
}));

describe("IssueRelatedWorkPanel", () => {
  it("renders outbound and inbound related work with source labels", () => {
    const html = renderToStaticMarkup(
      <IssueRelatedWorkPanel
        relatedWork={{
          outbound: [
            {
              issue: {
                id: "issue-2",
                identifier: "PAP-22",
                title: "Downstream task",
                status: "todo",
                priority: "medium",
                assigneeAgentId: null,
                assigneeUserId: null,
              },
              mentionCount: 2,
              sources: [
                { kind: "title", sourceRecordId: null, label: "title", matchedText: "PAP-22" },
                { kind: "document", sourceRecordId: "doc-1", label: "plan", matchedText: "/issues/PAP-22" },
              ],
            },
          ],
          inbound: [
            {
              issue: {
                id: "issue-3",
                identifier: "PAP-33",
                title: "Upstream task",
                status: "in_progress",
                priority: "high",
                assigneeAgentId: null,
                assigneeUserId: null,
              },
              mentionCount: 1,
              sources: [
                { kind: "comment", sourceRecordId: "comment-1", label: "comment", matchedText: "PAP-1" },
              ],
            },
          ],
        }}
      />,
    );

    expect(html).toContain("References");
    expect(html).toContain("Referenced by");
    expect(html).toContain("PAP-22");
    expect(html).toContain("PAP-33");
    expect(html).toContain('aria-label="Issue PAP-22: Downstream task"');
    expect(html).toContain('aria-label="Issue PAP-33: Upstream task"');
    expect(html).toContain("plan");
    expect(html).toContain("comment");
  });
});
