"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Sun, Moon, Menu, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useTheme } from "@/components/layout/ThemeProvider";
import { AvatarDropdown } from "@/components/layout/AvatarDropdown";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { NAV_LINKS_PUBLIC, NAV_LINKS_MEMBER } from "@/lib/constants";
import { cn } from "@/lib/utils/cn";
import { resetAnalytics, track } from "@/lib/analytics/track";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function ThemeToggle({ theme, onToggle, className, transparent }: {
  theme: string; onToggle: () => void; className?: string; transparent?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full",
        "transition-all duration-200 hover:border-gold hover:text-gold",
        transparent
          ? "border border-white/30 text-white/70"
          : "border border-border text-text-secondary",
        className
      )}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  // Only use white-on-transparent styling on the home page (dark hero background)
  const isHeroPage = pathname === "/";
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const handleScroll = useCallback(() => {
    setIsScrolled(window.scrollY > 20);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Auth state — onAuthStateChange listener (mount-only)
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | undefined;

    async function initAuth() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        const {
          data: { subscription: sub },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
          setUser(session?.user ?? null);
          if (session?.user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', session.user.id)
              .single()
            setIsAdmin(profile?.role === 'admin')
          } else {
            setIsAdmin(false)
          }
        });
        subscription = sub;
      } catch {
        setUser(null);
      }
    }

    initAuth();
    return () => subscription?.unsubscribe();
  }, []);

  // Re-check auth on every route change — uses getSession() (reads cookie directly,
  // no network request) rather than getUser() (network call to Supabase Auth server).
  useEffect(() => {
    async function checkAuth() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        // eslint-disable-next-line no-console
        console.log('[Header] checking auth, pathname:', pathname);
        const { data: { session }, error } = await supabase.auth.getSession();
        // eslint-disable-next-line no-console
        console.log('[Header] session result:', { hasSession: !!session, email: session?.user?.email, error: error?.message });
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        if (currentUser) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', currentUser.id)
            .single()
          setIsAdmin(profile?.role === 'admin')
        } else {
          setIsAdmin(false)
        }
      } catch {
        setUser(null);
        setIsAdmin(false);
      }
    }
    checkAuth();
  }, [pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const handleSignOut = async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
      track("logout", {});
      resetAnalytics();
      setUser(null);
      closeMobileMenu();
      router.push("/");
      router.refresh();
    } catch {
      // Ignore sign-out errors
    }
  };

  const navLinks = user
    ? NAV_LINKS_MEMBER
    : NAV_LINKS_PUBLIC.filter((l) => l.label !== "Sign In");

  const userFullName =
    user?.user_metadata?.full_name ?? user?.email ?? "Member";
  const userInitials = getInitials(userFullName);
  const avatarUrl = (user?.user_metadata?.avatar_url as string) ?? null;

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          isScrolled
            ? "bg-[var(--header-bg)] backdrop-blur-xl border-b border-[var(--header-border)] shadow-sm"
            : "bg-transparent"
        )}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between sm:h-20">
            {/* Logo */}
            <Link
              href="/"
              className="group flex items-center gap-2"
              onClick={closeMobileMenu}
            >
              <span className={cn(
                "font-serif text-xl font-bold tracking-tight transition-colors duration-300 sm:text-2xl",
                isHeroPage && !isScrolled ? "text-white" : "text-text-primary"
              )}>
                The Social{" "}
                <span className="text-gold">Seen</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "relative px-4 py-2 text-sm font-medium tracking-wide transition-colors duration-200 hover:text-gold",
                    "after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-0 after:bg-gold after:transition-all after:duration-300 after:-translate-x-1/2",
                    "hover:after:w-3/4",
                    isHeroPage && !isScrolled ? "text-white/80" : "text-text-secondary"
                  )}
                >
                  {link.label}
                </Link>
              ))}

              <ThemeToggle theme={theme} onToggle={toggleTheme} className="ml-4" transparent={isHeroPage && !isScrolled} />

              {/* Auth: Avatar dropdown or Sign In */}
              {user ? (
                <div className="ml-2">
                  <AvatarDropdown
                    avatarUrl={avatarUrl}
                    initials={userInitials}
                    onSignOut={handleSignOut}
                    isAdmin={isAdmin}
                  />
                </div>
              ) : (
                <Link
                  href="/login"
                  className={cn(
                    "ml-2 inline-flex items-center justify-center rounded-full px-5 py-2",
                    "text-sm font-medium transition-all duration-200",
                    "hover:border-gold hover:text-gold",
                    isHeroPage && !isScrolled
                      ? "border border-white/30 text-white/80"
                      : "border border-border text-text-secondary"
                  )}
                >
                  Sign In
                </Link>
              )}
            </nav>

            {/* Mobile Controls */}
            <div className="flex items-center gap-3 md:hidden">
              <ThemeToggle theme={theme} onToggle={toggleTheme} transparent={isHeroPage && !isScrolled} />

              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full",
                  "transition-all duration-200 hover:border-gold hover:text-gold",
                  isHeroPage && !isScrolled
                    ? "border border-white/30 text-white/70"
                    : "border border-border text-text-secondary"
                )}
                aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Menu className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={closeMobileMenu}
        user={user}
        navLinks={navLinks}
        userFullName={userFullName}
        userInitials={userInitials}
        avatarUrl={avatarUrl}
        onSignOut={handleSignOut}
        isAdmin={isAdmin}
      />
    </>
  );
}
