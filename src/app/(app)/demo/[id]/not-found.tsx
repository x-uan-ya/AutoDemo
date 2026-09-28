import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function DemoNotFound() {
  return (
    <div className="py-12">
      <EmptyState
        icon={FileQuestion}
        title="Demo not found"
        description="This demo project does not exist or may have been removed."
        actionLabel="Back to dashboard"
        actionHref="/dashboard"
      />
    </div>
  );
}
