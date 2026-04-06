"use client";

import Link from "next/link";
import Image from "next/image";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { User, CalendarDays, LogOut, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface AvatarDropdownProps {
  avatarUrl: string | null;
  initials: string;
  onSignOut: () => void;
  isAdmin?: boolean;
}

export function AvatarDropdown({
  avatarUrl,
  initials,
  onSignOut,
  isAdmin,
}: AvatarDropdownProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full",
            "transition-all duration-200",
            "hover:ring-2 hover:ring-gold/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          )}
          aria-label="Account menu"
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt="Your avatar"
              width={32}
              height={32}
              className="rounded-full object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold font-sans text-xs font-medium text-white">
              {initials}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 min-w-[180px] rounded-xl border border-border bg-bg-card p-1 shadow-lg",
            "animate-fade-in"
          )}
        >
          {isAdmin && (
            <DropdownMenu.Item asChild>
              <Link
                href="/admin"
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-primary",
                  "outline-none transition-colors hover:bg-bg-secondary focus:bg-bg-secondary"
                )}
              >
                <LayoutDashboard className="h-4 w-4 text-text-tertiary" />
                Dashboard
              </Link>
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Item asChild>
            <Link
              href="/profile"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-primary",
                "outline-none transition-colors hover:bg-bg-secondary focus:bg-bg-secondary"
              )}
            >
              <User className="h-4 w-4 text-text-tertiary" />
              Profile
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <Link
              href="/bookings"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-primary",
                "outline-none transition-colors hover:bg-bg-secondary focus:bg-bg-secondary"
              )}
            >
              <CalendarDays className="h-4 w-4 text-text-tertiary" />
              My Bookings
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            onSelect={onSignOut}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary",
              "cursor-pointer outline-none transition-colors hover:bg-bg-secondary focus:bg-bg-secondary"
            )}
          >
            <LogOut className="h-4 w-4 text-text-tertiary" />
            Sign Out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
