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
  // Escape characters that can break out of the <script> context or be
  // interpreted specially by HTML/JS parsers. Covers:
  //   <  — primary script-tag-break vector (the original guard)
  //   >  — defence-in-depth for HTML-context parsers
  //   &  — prevents &amp; entity-ambiguity inside string values
  //   U+2028 / U+2029 — JSON-valid but break JS string literals in
  //                     older parsers. Mirrors serialize-javascript.
  const json = JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  )

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
