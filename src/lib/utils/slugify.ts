// ── Slug generation ───────────────────────────────────────────────────────────
// Generates URL-safe slugs from event titles.
// Used when creating events in the admin panel and for display in the browser.

/**
 * Convert a string to a URL-safe slug.
 *
 * Examples:
 *   "Wine & Wisdom at Borough Market" → "wine-and-wisdom-at-borough-market"
 *   "Chef's Table at The Clove Club"  → "chefs-table-at-the-clove-club"
 *   "Jazz & Cocktails — Ronnie Scott's" → "jazz-and-cocktails-ronnie-scotts"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')          // & → and
    .replace(/['']/g, '')          // remove apostrophes (curly and straight)
    .replace(/[—–]/g, '-')         // em/en dash → hyphen BEFORE stripping specials
    .replace(/[^\w\s-]/g, '')      // remove remaining non-word chars (except hyphens)
    .replace(/[\s_]+/g, '-')       // spaces and underscores → hyphen
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-|-$/g, '')         // strip leading/trailing hyphens
}

/**
 * Generate a unique slug by appending a numeric suffix if needed.
 * Pass an `exists` function that returns true if the slug is already taken.
 *
 * Example usage (in a server action):
 *   const slug = await uniqueSlug(title, (s) =>
 *     supabase.from('events').select('id').eq('slug', s).single().then(r => !!r.data)
 *   )
 */
export async function uniqueSlug(
  text: string,
  exists: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(text)
  let slug    = base
  let counter = 2

  while (await exists(slug)) {
    slug = `${base}-${counter}`
    counter++
  }

  return slug
}
