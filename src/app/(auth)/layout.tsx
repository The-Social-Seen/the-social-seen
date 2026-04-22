/**
 * Auth layout — suppresses the site header and footer.
 * Renders a full-screen overlay so auth pages have their own chrome.
 * `<main>` is the route group's primary landmark (root layout intentionally
 * omits one so pages / layouts can declare exactly one per route).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="fixed inset-0 z-50 overflow-y-auto bg-bg-primary">
      {children}
    </main>
  )
}
