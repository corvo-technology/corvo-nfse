import { notFound } from "next/navigation";
import { DocsSidebar, type SidebarGroup } from "@/components/docs/sidebar";
import { DOC_GROUPS, getDocsTree } from "@/lib/docs/registry";

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tree = getDocsTree(locale);
  if (!tree) notFound();

  const groups: SidebarGroup[] = DOC_GROUPS.map((group) => ({
    label: tree.chrome.groups[group.key],
    items: group.slugs.map((slug) => ({
      slug,
      title: tree.pages[slug].title,
      href: `/${locale}/docs/${slug}`,
    })),
  }));

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex w-full max-w-[1200px] px-4">
        <DocsSidebar
          homeLabel={tree.chrome.homeLabel}
          homeHref={`/${locale}/docs`}
          groups={groups}
          closeLabel={tree.chrome.copy.close}
          menuLabel={tree.chrome.copy.menu}
        />
        <main id="content" className="min-w-0 flex-1 px-4 py-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
