import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — The Social Seen',
  description:
    'How The Social Seen collects, uses, and protects your personal data under UK GDPR.',
}

/**
 * P2-8b — Privacy Policy page.
 *
 * Scope: the operational mechanics members need to understand —
 * what we collect, why, how long, who we share with, and what their
 * rights are. Deliberately NOT a lawyer-drafted final document; the
 * cofounder will want a solicitor pass before launch. The content
 * here reflects what the code actually does, which is the hardest
 * part to get right.
 *
 * Update trigger: any time we add a new third-party processor, new
 * data category, or change retention — come back here and update
 * the relevant section + bump the "Last updated" date at the top.
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl font-bold text-text-primary">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-text-primary/60">
        Last updated: 21 April 2026
      </p>

      <div className="prose prose-sm mt-8 max-w-none space-y-6 text-text-primary/80">
        <section>
          <h2 className="mt-0 font-serif text-xl font-bold text-text-primary">
            Who we are
          </h2>
          <p>
            The Social Seen is a curated social events platform for
            London professionals, operated by The Social Seen Ltd
            (company to be registered). We&rsquo;re the data controller
            for the personal data described below.
          </p>
          <p>
            Contact us at{' '}
            <a
              href="mailto:info@the-social-seen.com"
              className="font-medium text-gold hover:text-gold-hover"
            >
              info@the-social-seen.com
            </a>{' '}
            with any privacy questions.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            What we collect
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account data:</strong> email, full name, phone
              number, password hash (via Supabase Auth).
            </li>
            <li>
              <strong>Profile details:</strong> job title, company,
              industry, bio, LinkedIn URL, interests, profile photo
              &mdash; all optional and self-provided.
            </li>
            <li>
              <strong>Booking history:</strong> which events you booked,
              waitlisted, cancelled, attended, or were marked
              no-show for.
            </li>
            <li>
              <strong>Reviews:</strong> ratings and text reviews you
              leave for events.
            </li>
            <li>
              <strong>Payment records:</strong> the fact that you paid,
              when, how much, and whether refunded. We do <em>not</em>{' '}
              store card numbers &mdash; Stripe handles all card data.
              We keep a Stripe Customer id so you can reuse saved cards.
            </li>
            <li>
              <strong>Communication log:</strong> a record that we sent
              you an email (to support retries + GDPR compliance). The
              content is anonymised when you delete your account.
            </li>
            <li>
              <strong>Analytics:</strong> if you consent to cookies, we
              track page views and key events via PostHog (EU hosting).
              No cookies means no analytics &mdash; the site still works
              fully.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Why we collect it
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Contract:</strong> bookings, payments, reviews,
              and event attendance are necessary to run the service.
            </li>
            <li>
              <strong>Legitimate interests:</strong> sending event
              reminders and venue-reveal emails, moderating members to
              keep the community good, improving the product through
              aggregated analytics (with your consent).
            </li>
            <li>
              <strong>Consent:</strong> marketing email (optional at
              sign-up, revocable any time) and analytics cookies.
            </li>
            <li>
              <strong>Legal obligation:</strong> accounting records
              retained as required by UK law (typically 6 years after
              the tax year for payment records).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Who we share with
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Supabase</strong> (database + auth, EU hosting).
            </li>
            <li>
              <strong>Vercel</strong> (website hosting, global edge).
            </li>
            <li>
              <strong>Stripe</strong> (payments, Ireland + US, standard
              contractual clauses).
            </li>
            <li>
              <strong>Resend</strong> (transactional email, US, SCCs).
            </li>
            <li>
              <strong>PostHog</strong> (analytics, EU hosting, consent-
              gated).
            </li>
            <li>
              <strong>Sentry</strong> (error reporting, EU/US).
            </li>
          </ul>
          <p>
            We do <em>not</em> sell your data to anyone, ever. We do
            <em> not </em>share it with marketing or advertising
            networks.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            How long we keep it
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Active accounts:</strong> as long as you remain a
              member.
            </li>
            <li>
              <strong>Deleted accounts:</strong> profile is anonymised
              immediately, hard-deleted 30 days later. If you ever
              booked a paid event, your Stripe Customer record is
              deleted at the same time &mdash; Stripe keeps Charge
              records separately for UK tax compliance. Bookings that
              affect aggregate reporting (attendance counts) keep the
              booking row but lose all identifying fields.
            </li>
            <li>
              <strong>Payment records:</strong> retained for 6 years
              from the end of the relevant tax year.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Your rights
          </h2>
          <p>Under UK GDPR you have the right to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Access the data we hold about you &mdash; use{' '}
              <Link
                href="/profile"
                className="font-medium text-gold hover:text-gold-hover"
              >
                Your data &amp; privacy
              </Link>{' '}
              on your profile to download it instantly.
            </li>
            <li>Correct inaccurate data &mdash; edit your profile at any time.</li>
            <li>
              Erase your data &mdash; same profile page, Delete my
              account.
            </li>
            <li>Restrict or object to processing &mdash; email us.</li>
            <li>Data portability &mdash; the download is in JSON.</li>
            <li>Withdraw consent &mdash; uncheck marketing consent in your profile, or decline analytics cookies.</li>
            <li>
              Complain to the{' '}
              <a
                href="https://ico.org.uk/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-gold hover:text-gold-hover"
              >
                ICO
              </a>{' '}
              if you think we&rsquo;ve mishandled your data.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Cookies
          </h2>
          <p>
            We use a session cookie (strictly necessary) to keep you
            logged in. If you consent, we also set a PostHog analytics
            cookie. You can decline or change your choice any time via
            the cookie banner or your browser settings.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Changes to this policy
          </h2>
          <p>
            If we change how we handle your data we&rsquo;ll update
            this page and, for material changes, email the account
            address. The &ldquo;Last updated&rdquo; date at the top is
            the authoritative version marker.
          </p>
        </section>
      </div>
    </main>
  )
}
