"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon, Menu, X } from "lucide-react";
import { useTheme } from "@/components/layout/ThemeProvider";
import { cn } from "@/lib/utils/cn";

const navLinks = [
  { label: "Events", href: "#events" },
  { label: "Gallery", href: "#gallery" },
  { label: "About", href: "#about" },
  { label: "Join", href: "#join" },
];

const menuVariants = {
  closed: {
    x: "100%",
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 40,
    },
  },
  open: {
    x: "0%",
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 40,
    },
  },
};

const menuItemVariants = {
  closed: { opacity: 0, x: 50 },
  open: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: 0.1 + i * 0.08,
      type: "spring" as const,
      stiffness: 300,
      damping: 30,
    },
  }),
};

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleScroll = useCallback(() => {
    setIsScrolled(window.scrollY > 20);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

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
              <span className="font-serif text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
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
                    "relative px-4 py-2 text-sm font-medium tracking-wide text-text-secondary",
                    "transition-colors duration-200 hover:text-gold",
                    "after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-0 after:bg-gold after:transition-all after:duration-300 after:-translate-x-1/2",
                    "hover:after:w-3/4"
                  )}
                >
                  {link.label}
                </Link>
              ))}

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className={cn(
                  "ml-4 flex h-9 w-9 items-center justify-center rounded-full",
                  "border border-border transition-all duration-200",
                  "hover:border-gold hover:text-gold",
                  "text-text-secondary"
                )}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </button>
            </nav>

            {/* Mobile Controls */}
            <div className="flex items-center gap-3 md:hidden">
              {/* Theme Toggle (Mobile) */}
              <button
                onClick={toggleTheme}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full",
                  "border border-border transition-all duration-200",
                  "hover:border-gold hover:text-gold",
                  "text-text-secondary"
                )}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </button>

              {/* Hamburger Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full",
                  "border border-border transition-all duration-200",
                  "hover:border-gold hover:text-gold",
                  "text-text-secondary"
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

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-[var(--color-overlay)]"
              onClick={closeMobileMenu}
              aria-hidden="true"
            />

            {/* Slide-over Drawer */}
            <motion.div
              variants={menuVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className={cn(
                "fixed inset-y-0 right-0 z-50 w-full max-w-sm",
                "bg-bg-primary shadow-2xl",
                "flex flex-col"
              )}
            >
              {/* Drawer Header */}
              <div className="flex h-16 items-center justify-between border-b border-border px-6 sm:h-20">
                <span className="font-serif text-xl font-bold tracking-tight text-text-primary">
                  The Social <span className="text-gold">Seen</span>
                </span>
                <button
                  onClick={closeMobileMenu}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    "border border-border transition-all duration-200",
                    "hover:border-gold hover:text-gold",
                    "text-text-secondary"
                  )}
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Drawer Nav Links */}
              <nav className="flex flex-1 flex-col justify-center gap-2 px-6">
                {navLinks.map((link, i) => (
                  <motion.div
                    key={link.label}
                    variants={menuItemVariants}
                    custom={i}
                    initial="closed"
                    animate="open"
                    exit="closed"
                  >
                    <Link
                      href={link.href}
                      onClick={closeMobileMenu}
                      className={cn(
                        "block rounded-xl px-4 py-4 font-serif text-2xl font-semibold",
                        "text-text-primary transition-all duration-200",
                        "hover:bg-bg-secondary hover:text-gold"
                      )}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>

              {/* Drawer Footer */}
              <div className="border-t border-border px-6 py-6">
                <p className="text-center text-sm text-text-tertiary">
                  Where Connections Become Stories
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
