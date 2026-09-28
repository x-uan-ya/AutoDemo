import { Sidebar } from "@/components/layout/sidebar";

/**
 * Shell layout for the application pages (dashboard, create, demo detail).
 * Adds the sidebar alongside the page content. The Navbar comes from the root
 * layout, so it is not repeated here.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container flex flex-1 gap-0 md:gap-8">
      <Sidebar />
      <main className="flex-1 py-8">{children}</main>
    </div>
  );
}
