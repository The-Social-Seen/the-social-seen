import { getAdminReviews } from '../actions'
import ReviewsTable from '@/components/admin/ReviewsTable'

export const metadata = {
  title: 'Reviews — Admin — The Social Seen',
}

export default async function AdminReviewsPage() {
  const reviews = await getAdminReviews('all')

  // Normalise Supabase join results
  const normalised = reviews.map((r) => ({
    ...r,
    author: Array.isArray(r.author) ? r.author[0] ?? null : r.author ?? null,
    event: Array.isArray(r.event) ? r.event[0] ?? null : r.event ?? null,
  }))

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl text-text-primary">Reviews</h1>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <ReviewsTable reviews={normalised} />
      </div>
    </div>
  )
}
