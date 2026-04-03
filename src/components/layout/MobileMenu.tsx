"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, LogOut } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils/cn";

const menuVariants = {
  closed: {
    x: "100%",
    transition: { type: "spring" as const, stiffness: 400, damping: 40 },
  },
  open: {
    x: "0%",
    transition: { type: "spring" as const, stiffness: 400, damping: 40 },
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

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  navLinks: ReadonlyArray<{ readonly label: string; readonly href: string }>;
  userFullName: string;
  userInitials: string;
  avatarUrl: string | null;
  onSignOut: () => void;
}

export function MobileMenu({
  isOpen,
  onClose,
  user,
  navLinks,
  userFullName,
  userInitials,
  avatarUrl,
  onSignOut,
}: MobileMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[var(--color-overlay)]"
            onClick={onClose}
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
              {user ? (
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt=""
                      width={36}
                      height={36}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-sans text-sm font-medium text-white">
                      {userInitials}
                    </span>
                  )}
                  <div>
                    <p className="font-sans text-sm font-medium text-text-primary">
                      {userFullName}
                    </p>
                    <Link
                      href="/profile"
                      onClick={onClose}
                      className="font-sans text-xs text-gold"
                    >
                      View Profile
                    </Link>
                  </div>
                </div>
              ) : (
                <span className="font-serif text-xl font-bold tracking-tight text-text-primary">
                  The Social <span className="text-gold">Seen</span>
                </span>
              )}
              <button
                onClick={onClose}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full",
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
                    onClick={onClose}
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

              {/* Unauthenticated: Sign In */}
              {!user && (
                <motion.div
                  variants={menuItemVariants}
                  custom={navLinks.length}
                  initial="closed"
                  animate="open"
                  exit="closed"
                >
                  <Link
                    href="/login"
                    onClick={onClose}
                    className={cn(
                      "block rounded-xl px-4 py-4 font-serif text-2xl font-semibold",
                      "text-text-primary transition-all duration-200",
                      "hover:bg-bg-secondary hover:text-gold"
                    )}
                  >
                    Sign In
                  </Link>
                </motion.div>
              )}

              {/* Authenticated: Profile */}
              {user && (
                <motion.div
                  variants={menuItemVariants}
                  custom={navLinks.length}
                  initial="closed"
                  animate="open"
                  exit="closed"
                >
                  <Link
                    href="/profile"
                    onClick={onClose}
                    className={cn(
                      "block rounded-xl px-4 py-4 font-serif text-2xl font-semibold",
                      "text-text-primary transition-all duration-200",
                      "hover:bg-bg-secondary hover:text-gold"
                    )}
                  >
                    Profile
                  </Link>
                </motion.div>
              )}
            </nav>

            {/* Drawer Footer */}
            <div className="border-t border-border px-6 py-6">
              {user ? (
                <button
                  onClick={onSignOut}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3",
                    "font-sans text-sm font-medium text-text-secondary",
                    "transition-colors hover:bg-bg-secondary hover:text-text-primary"
                  )}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              ) : (
                <p className="text-center text-sm text-text-tertiary">
                  Where Connections Become Stories
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
