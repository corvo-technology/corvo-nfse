import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/**
 * Loading placeholder for a detail page: same silhouette as PageHeader plus two cards, so the
 * page does not jump when the data arrives. The parent announces the state through role="status".
 */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex max-w-[900px] flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <Skeleton className="h-8 w-2/3 max-w-[340px]" />
          <Skeleton className="h-4 w-1/2 max-w-[260px]" />
        </div>
        <div className="flex gap-2.5">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    </div>
  );
}
