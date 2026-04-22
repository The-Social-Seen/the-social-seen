"use client";

import Link from "next/link";
import { Instagram } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SOCIAL_LINKS } from "@/lib/constants";
import NewsletterSignupForm from "@/components/layout/NewsletterSignupForm";

// Split into two thematic groups so a single scanning pass is obvious
// on mobile and doesn't leave one column at 8 vertical entries.
const discoverLinks = [
  { label: "Events", href: "/events" },
  { label: "Past Events", href: "/events/past" },
  { label: "Gallery", href: "/gallery" },
  { label: "About", href: "/about" },
];

const connectLinks = [
  { label: "Contact", href: "/contact" },
  { label: "Collaborate", href: "/collaborate" },
  { label: "Join", href: "/join" },
  { label: "Sign In", href: "/login" },
];

// Single channel today — Instagram. Twitter / LinkedIn omitted until we
// actually have those accounts; placeholders shipped as broken anchor
// links would do more harm than good. Add additional entries to
// `SOCIAL_LINKS` in `src/lib/constants.ts` and surface them here.
const socialLinks = [
  {
    label: "Instagram",
    href: SOCIAL_LINKS.instagram,
    icon: Instagram,
  },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-bg-secondary">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          {/* Brand Column */}
          <div className="space-y-4">
            <Link href="/" className="inline-block">
              <h3 className="font-serif text-2xl font-bold tracking-tight text-text-primary">
                The Social <span className="text-gold">Seen</span>
              </h3>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
              Curated experiences for London&apos;s most interesting
              professionals.
            </p>

            {/* Social Icons */}
            <div className="flex items-center gap-3 pt-2">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    "border border-border transition-all duration-200",
                    "text-text-secondary hover:border-gold hover:text-gold",
                    "hover:bg-gold/10"
                  )}
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Discover Column */}
          <div>
            <h4 className="font-serif text-sm font-semibold uppercase tracking-widest text-text-primary">
              Discover
            </h4>
            <nav
              aria-label="Discover"
              className="mt-4 flex flex-col gap-3"
            >
              {discoverLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "text-sm text-text-secondary transition-colors duration-200",
                    "hover:text-gold"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Connect Column */}
          <div>
            <h4 className="font-serif text-sm font-semibold uppercase tracking-widest text-text-primary">
              Connect
            </h4>
            <nav
              aria-label="Connect"
              className="mt-4 flex flex-col gap-3"
            >
              {connectLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "text-sm text-text-secondary transition-colors duration-200",
                    "hover:text-gold"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Newsletter Column */}
          <div>
            <h4 className="font-serif text-sm font-semibold uppercase tracking-widest text-text-primary">
              Newsletter
            </h4>
            <p className="mt-4 text-sm text-text-secondary">
              Stay in the loop with curated events and insider stories.
            </p>
            <NewsletterSignupForm source="footer" variant="footer" />
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
          <p className="text-xs text-text-tertiary">
            &copy; {currentYear} The Social Seen. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="/privacy"
              className="text-xs text-text-tertiary transition-colors duration-200 hover:text-gold"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-xs text-text-tertiary transition-colors duration-200 hover:text-gold"
            >
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
