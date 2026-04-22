import type { Metadata } from 'next'
import { Mail, Instagram } from 'lucide-react'
import { canonicalUrl } from '@/lib/utils/site'
import { SOCIAL_LINKS } from '@/lib/constants'
import ContactForm from './ContactForm'

export const metadata: Metadata = {
  title: 'Contact — The Social Seen',
  description:
    'Get in touch with The Social Seen. General questions, event enquiries, collaboration ideas, or press — we read every message.',
  alternates: { canonical: canonicalUrl('/contact') },
}

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
          <p className="mb-3 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Contact
          </p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Say hello
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
            Questions about an event, ideas for one we should run, press
            enquiries, or just want to introduce yourself. Drop us a note —
            we read every message.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr] lg:gap-12">
          <div className="rounded-xl border border-border bg-bg-card p-6 md:p-8">
            <ContactForm />
          </div>

          <aside className="space-y-6 text-sm">
            <div>
              <h2 className="mb-2 font-serif text-base text-text-primary">
                Other ways to reach us
              </h2>
              <p className="text-text-secondary">
                For anything time-sensitive, the fastest route is Instagram DM.
              </p>
            </div>

            <a
              href={SOCIAL_LINKS.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4 transition-colors hover:border-gold/40"
            >
              <Instagram className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div className="min-w-0">
                <p className="font-medium text-text-primary">
                  @the_social_seen
                </p>
                <p className="text-text-tertiary">
                  Follow + DM for fastest reply
                </p>
              </div>
            </a>

            <a
              href="mailto:info@the-social-seen.com"
              className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4 transition-colors hover:border-gold/40"
            >
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div className="min-w-0">
                <p className="font-medium text-text-primary">
                  info@the-social-seen.com
                </p>
                <p className="text-text-tertiary">
                  Same as the form, just direct
                </p>
              </div>
            </a>

            <p className="text-xs text-text-tertiary">
              Brand or venue partnership pitch? Use the{' '}
              <a
                href="/collaborate"
                className="font-medium text-gold underline-offset-2 hover:underline"
              >
                collaborate form
              </a>{' '}
              instead — it captures the bits we need to reply quickly.
            </p>
          </aside>
        </div>
      </section>
    </main>
  )
}
