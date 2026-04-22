/**
 * Render a JSON-LD `<script>` tag with safe HTML escaping for the
 * payload. Used by SEO surfaces (Event schema on event pages,
 * Organization schema on the root layout).
 *
 * Why a component rather than a one-liner each time: centralises the
 * `dangerouslySetInnerHTML` boundary, keeps the `<` escape consistent
 * across call sites, and gives a single place to add validation later.
 */
interface JsonLdProps {
  data: Record<string, unknown>
}

export function JsonLd({ data }: JsonLdProps) {
  // JSON.stringify can produce `</` sequences inside string values
  // (e.g. someone's bio mentions an HTML tag). Escape the closing slash
  // to avoid breaking out of the script tag — a standard JSON-LD
  // injection guard.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
