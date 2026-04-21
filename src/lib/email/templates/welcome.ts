import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderShell,
} from './_shared'

export interface WelcomeTemplateInput {
  fullName: string
}

export interface RenderedTemplate {
  subject: string
  html: string
  text: string
}

/**
 * Sent once after the user completes onboarding (Step 3 of the join
 * flow). Friendly intro to the community + nudge to browse events.
 */
export function welcomeTemplate({
  fullName,
}: WelcomeTemplateInput): RenderedTemplate {
  const firstName = fullName.split(/\s+/)[0] || fullName
  const siteUrl = getSiteUrl()

  const subject = `Welcome to The Social Seen`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  Welcome, ${escapeHtml(firstName)}.
</h1>

<p style="margin:0 0 16px 0;">
  You&rsquo;re officially in. The Social Seen is a curated community for London
  professionals who think the best evenings are the ones spent with the right
  people.
</p>

<p style="margin:0 0 16px 0;">
  Wine tastings, supper clubs, gallery openings, run clubs, networking nights
  &mdash; we organise the kind of events that turn into stories. Browse what&rsquo;s
  coming up and book your first one in a couple of taps.
</p>

${renderButton({ label: 'See What\u2019s On', href: `${siteUrl}/events` })}

<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Some friendly tips:
</p>
<ul style="margin:8px 0 0 0;padding-left:20px;font-size:14px;color:${COLORS.textSecondary};line-height:1.7;">
  <li>Verify your email so you can book events &mdash; we sent a separate code earlier.</li>
  <li>Complete your profile so other members can put a name to a face.</li>
  <li>Some events fill up fast; the waitlist works and we promote spaces as they open.</li>
</ul>

<p style="margin:32px 0 0 0;">
  See you at one soon.
</p>
<p style="margin:8px 0 0 0;color:${COLORS.textSecondary};">
  &mdash; The Social Seen team
</p>`

  const html = renderShell({
    previewText: `You're in, ${firstName}. Here's what's coming up.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
