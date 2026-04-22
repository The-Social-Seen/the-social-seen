import type { Metadata } from 'next'
import { canonicalUrl } from '@/lib/utils/site'
import { LEGAL_LAST_UPDATED } from '@/lib/legal/constants'

export const metadata: Metadata = {
  title: 'Terms of Service — The Social Seen',
  description:
    'The terms governing membership of The Social Seen community and use of our events platform.',
  alternates: { canonical: canonicalUrl('/terms') },
}

/**
 * P2-8b — Terms of Service page.
 *
 * Scope: practical community guidelines + the commercial terms that
 * already match how the code behaves (48h refund policy, waitlist
 * first-click wins, moderation, etc.). A solicitor should review
 * before real launch; this version keeps the expectations honest and
 * matches the product.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl font-bold text-text-primary">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-text-primary/60">
        Last updated: {LEGAL_LAST_UPDATED}
      </p>

      <div className="prose prose-sm mt-8 max-w-none space-y-6 text-text-primary/80">
        <section>
          <h2 className="mt-0 font-serif text-xl font-bold text-text-primary">
            1. Who we are
          </h2>
          <p>
            The Social Seen is a curated social events platform for
            London-based professionals, operated by The Social Seen
            Ltd. By joining or booking an event you agree to these
            terms.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            2. Membership
          </h2>
          <p>
            Membership is free. To book events you must verify your
            email address. We reserve the right to suspend or close
            accounts where members act against the community
            guidelines in section 6 or otherwise disrupt events.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            3. Bookings and waitlists
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Some events are free. Others require upfront payment in
              GBP via Stripe.
            </li>
            <li>
              If an event is full you can join the waitlist. Waitlist
              entry is free. When a confirmed attendee cancels, we
              email everyone on the waitlist simultaneously &mdash;
              first to pay (or claim, for free events) wins the spot.
            </li>
            <li>
              Bookings are personal and not transferable without our
              prior written consent.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            4. Payment, cancellation and refunds
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Free events:</strong> you can cancel any time up
              to the event start with no penalty.
            </li>
            <li>
              <strong>Paid events &mdash; more than 48 hours before the
              event start:</strong> full refund to your original payment
              method. Stripe processing fees are the only exception
              (see your receipt for the net amount).
            </li>
            <li>
              <strong>Paid events &mdash; within 48 hours of the event
              start:</strong> no refund. The seat is released so a
              waitlister can claim it.
            </li>
            <li>
              If we cancel an event ourselves you get a full refund
              regardless of timing.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            5. No-shows
          </h2>
          <p>
            Repeated no-shows (failing to attend an event you booked
            without cancelling first) affect the community &mdash;
            seats sit empty that a waitlister could have used. We
            track no-shows and may decline future bookings or close
            accounts where no-shows become a pattern.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            6. Community guidelines
          </h2>
          <p>
            You agree to be respectful to other members, event hosts,
            and venue staff. Specifically:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              No discrimination, harassment, or abusive behaviour.
            </li>
            <li>
              No recruitment or sales pitches at events unless the
              event is explicitly for that (e.g. networking formats).
            </li>
            <li>
              Respect venue rules, dress codes, and quiet-hour
              requests.
            </li>
            <li>
              Don&rsquo;t share member contact details externally
              without consent.
            </li>
          </ul>
          <p>
            Breaches may result in warnings, suspension, or a
            permanent ban. We have no obligation to explain specific
            reasons for moderation decisions.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            7. Your content
          </h2>
          <p>
            Reviews and photos you submit remain yours. By posting
            you grant us a non-exclusive licence to display them on
            the site. We may remove reviews or photos that breach
            section 6 or contain personal information about others
            without consent.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            8. Liability
          </h2>
          <p>
            Events happen at third-party venues. We curate carefully
            but we&rsquo;re not responsible for the venue&rsquo;s
            service, food, drink, or any loss or injury that occurs
            there. Members attend at their own risk and should
            exercise their usual judgement. Nothing in these terms
            limits liability for death, personal injury caused by
            negligence, or fraud &mdash; which would be against UK
            law.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            9. Privacy
          </h2>
          <p>
            How we handle your personal data is covered in our{' '}
            <a
              href="/privacy"
              className="font-medium text-gold hover:text-gold-hover"
            >
              Privacy Policy
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            10. Changes to these terms
          </h2>
          <p>
            We may update these terms. Material changes are emailed to
            the account address. Continued use of the service after an
            update means you accept the new version.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            11. Governing law
          </h2>
          <p>
            These terms are governed by the laws of England and Wales.
            Disputes go to the courts of England and Wales.
          </p>
        </section>
      </div>
    </main>
  )
}
