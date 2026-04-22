import type { Metadata } from 'next'
import { canonicalUrl } from '@/lib/utils/site'
import CollaborateForm from './CollaborateForm'

export const metadata: Metadata = {
  title: 'Collaborate — The Social Seen',
  description:
    'Partner with The Social Seen. We work with London venues, brands, and sponsors to put on the kind of events our community keeps asking for.',
  alternates: { canonical: canonicalUrl('/collaborate') },
}

export default function CollaboratePage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
          <p className="mb-3 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Partnerships
          </p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Collaborate with us
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
            We work with London venues, brands, and sponsors to host the kind
            of events our community keeps asking for. Tell us what you have
            in mind — the more specific the pitch, the faster we can reply.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr] lg:gap-12">
          <div className="rounded-xl border border-border bg-bg-card p-6 md:p-8">
            <CollaborateForm />
          </div>

          <aside className="space-y-4 text-sm text-text-secondary">
            <div>
              <h2 className="mb-2 font-serif text-base text-text-primary">
                What works
              </h2>
              <ul className="space-y-1.5 list-disc pl-5">
                <li>
                  <span className="text-text-primary">Venues</span> with
                  character — converted warehouses, private dining rooms,
                  rooftops, gardens.
                </li>
                <li>
                  <span className="text-text-primary">Brands</span> aligned
                  with London professionals in their 30s–40s — wine, spirits,
                  wellness, design, food.
                </li>
                <li>
                  <span className="text-text-primary">Sponsors</span>{' '}
                  underwriting a series rather than a one-off — we&rsquo;d
                  rather build a long story together.
                </li>
              </ul>
            </div>

            <div>
              <h2 className="mb-2 font-serif text-base text-text-primary">
                What doesn&rsquo;t
              </h2>
              <p>
                Generic networking sponsorships, hard-sell brand activations,
                or anything that turns the evening into an advert. We curate
                ruthlessly to keep the experience right for our members.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
