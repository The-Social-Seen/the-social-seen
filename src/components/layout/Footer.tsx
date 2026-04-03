"use client";

import Link from "next/link";
import { Instagram, Twitter, Linkedin, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const quickLinks = [
  { label: "Events", href: "#events" },
  { label: "Gallery", href: "#gallery" },
  { label: "Join", href: "#join" },
  { label: "Login", href: "/login" },
];

const socialLinks = [
  {
    label: "Instagram",
    href: "https://instagram.com",
    icon: Instagram,
  },
  {
    label: "X (Twitter)",
    href: "https://x.com",
    icon: Twitter,
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com",
    icon: Linkedin,
  },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-bg-secondary">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-3">
          {/* Brand Column */}
          <div className="space-y-4">
            <Link href="/" className="inline-block">
              <h3 className="font-serif text-2xl font-bold tracking-tight text-text-primary">
                The Social <span className="text-gold">Seen</span>
              </h3>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
              A curated community for those who believe the best moments are
              experienced together. Where connections become stories.
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

          {/* Quick Links Column */}
          <div>
            <h4 className="font-serif text-sm font-semibold uppercase tracking-widest text-text-primary">
              Quick Links
            </h4>
            <nav className="mt-4 flex flex-col gap-3">
              {quickLinks.map((link) => (
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
            <form
              onSubmit={(e) => e.preventDefault()}
              className="mt-4 flex gap-2"
            >
              <input
                type="email"
                placeholder="Your email"
                className={cn(
                  "flex-1 rounded-lg border border-border bg-bg-primary px-4 py-2.5",
                  "text-sm text-text-primary placeholder:text-text-tertiary",
                  "transition-all duration-200",
                  "focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                )}
                aria-label="Email address for newsletter"
              />
              <button
                type="submit"
                className={cn(
                  "flex items-center justify-center rounded-lg px-4 py-2.5",
                  "bg-gold text-text-inverse",
                  "text-sm font-medium transition-all duration-200",
                  "hover:bg-gold-dark",
                  "focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2"
                )}
                aria-label="Subscribe to newsletter"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
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
