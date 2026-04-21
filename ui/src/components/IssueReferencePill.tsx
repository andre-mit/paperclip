import type { IssueRelationIssueSummary } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";

export function IssueReferencePill({
  issue,
  className,
}: {
  issue: Pick<IssueRelationIssueSummary, "id" | "identifier" | "title">;
  className?: string;
}) {
  const issueLabel = issue.identifier ?? issue.id;

  return (
    <Link
      to={`/issues/${issueLabel}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent/50",
        className,
      )}
      title={issue.title}
      aria-label={`Issue ${issueLabel}: ${issue.title}`}
    >
      <span className="h-1.5 w-1.5 rounded-[0.2rem] bg-current opacity-70" />
      <span>{issue.identifier ?? issue.title}</span>
    </Link>
  );
}
