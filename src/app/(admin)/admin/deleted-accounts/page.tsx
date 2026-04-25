import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDeletedAccounts } from '../actions'

export const metadata = {
  title: 'Deleted accounts — Admin — The Social Seen',
}

/**
 * P2-8b — Admin deletion-queue view.
 *
 * Read-only list of soft-deleted profiles. Profiles here have already
 * been anonymised by the `deleteMyAccount` Server Action (full_name
 * and email replaced with placeholders, PII cleared). The admin can
 * hard-delete manually via SQL after 30 days; Phase 3 automates.
 *
 * Kept intentionally minimal — no restore button, no bulk actions.
 * Account deletion is a serious operation and the admin should be
 * cautious; if a restore is needed it happens via direct DB access
 * after confirming with the member.
 */
// Helper sits outside the component so ESLint's "no impure calls in
// render" rule (designed for Client Components) doesn't flag this —
// DeletedAccountsPage is a Server Component and `Date.now()` is safe
// here anyway, but the rule is syntactic not semantic.
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

export default async function DeletedAccountsPage() {
  const accounts = await getDeletedAccounts()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Back to admin dashboard"
        >
          <ArrowLeft className="w-5 h-5 text-text-tertiary" />
        </Link>
        <div>
          <h1 className="font-serif text-2xl text-text-primary">
            Deleted accounts
          </h1>
          <p className="text-sm text-text-tertiary">
            Members who closed their account. Hard-deleted after 30 days (manual for now).
          </p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card p-8 text-center">
          <p className="text-sm text-text-tertiary">No deleted accounts.</p>
        </div>
      ) : (
        <>
          {/* Desktop table (≥ md) */}
          <div className="hidden md:block bg-bg-card border border-border rounded-xl p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 font-medium text-text-tertiary">User ID</th>
                  <th className="pb-3 font-medium text-text-tertiary">Placeholder name</th>
                  <th className="pb-3 font-medium text-text-tertiary">Deleted</th>
                  <th className="pb-3 font-medium text-text-tertiary">Joined</th>
                  <th className="pb-3 font-medium text-text-tertiary">Countdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((a) => {
                  const deletedAt = new Date(a.deleted_at!)
                  const daysSinceDeletion = daysSince(a.deleted_at!)
                  const daysToHardDelete = 30 - daysSinceDeletion
                  const overdue = daysToHardDelete <= 0

                  return (
                    <tr key={a.id} className="hover:bg-bg-secondary/50 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-text-tertiary">
                        {a.id.slice(0, 8)}&hellip;
                      </td>
                      <td className="py-3 pr-4 text-text-primary">{a.full_name}</td>
                      <td className="py-3 pr-4 text-text-tertiary whitespace-nowrap">
                        {formatDistanceToNow(deletedAt, { addSuffix: true })}
                      </td>
                      <td className="py-3 pr-4 text-text-tertiary whitespace-nowrap">
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {overdue ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                            <AlertCircle className="h-3 w-3" />
                            Hard-delete overdue
                          </span>
                        ) : (
                          <span className="text-xs text-text-tertiary">
                            {daysToHardDelete} day{daysToHardDelete === 1 ? '' : 's'} until hard-delete
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (< md) */}
          <ul className="md:hidden space-y-3">
            {accounts.map((a) => {
              const deletedAt = new Date(a.deleted_at!)
              const daysSinceDeletion = daysSince(a.deleted_at!)
              const daysToHardDelete = 30 - daysSinceDeletion
              const overdue = daysToHardDelete <= 0

              return (
                <li key={a.id}>
                  <article className="rounded-lg border border-border bg-bg-card p-4 space-y-3">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-text-primary truncate min-w-0 flex-1">
                        {a.full_name}
                      </p>
                      {overdue && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger shrink-0">
                          <AlertCircle className="h-3 w-3" />
                          Overdue
                        </span>
                      )}
                    </div>

                    {/* Body */}
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">User ID</dt>
                        <dd className="font-mono text-xs text-text-tertiary">
                          {a.id.slice(0, 8)}&hellip;
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Deleted</dt>
                        <dd className="text-text-secondary">
                          {formatDistanceToNow(deletedAt, { addSuffix: true })}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Joined</dt>
                        <dd className="text-text-secondary">
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Countdown</dt>
                        <dd className={overdue ? 'text-danger font-medium' : 'text-text-secondary'}>
                          {overdue
                            ? 'Hard-delete overdue'
                            : `${daysToHardDelete} day${daysToHardDelete === 1 ? '' : 's'} left`}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
