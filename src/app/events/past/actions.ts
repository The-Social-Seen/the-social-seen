'use server'

import { getPastEvents, type PastEventsPage } from '@/lib/supabase/queries/events'

/**
 * "Load more" Server Action — fetches the next cursor page of past
 * events. Called by `PastEventsLoadMore` (Client Component) when the
 * user clicks the button. Returns the same shape as the initial
 * server-rendered fetch.
 *
 * No auth gate: the archive is public; the underlying query already
 * filters to published, past-dated events.
 */
export async function loadMorePastEvents(
  cursor: string,
): Promise<PastEventsPage> {
  return getPastEvents({ cursor })
}
