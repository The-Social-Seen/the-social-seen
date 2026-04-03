"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { GoogleIcon } from "@/components/shared/GoogleIcon";

/* ------------------------------------------------------------------ */
/*  Main Login Page                                                    */
/* ------------------------------------------------------------------ */

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  function handleSignIn(e: React.FormEvent) {
    e.preventDefault();

    const newErrors: Record<string, boolean> = {};
    if (!email.trim()) newErrors.email = true;
    if (!password.trim()) newErrors.password = true;
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      router.push("/profile");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div
          className="h-full w-full"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, var(--color-charcoal) 1px, transparent 0)`,
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Decorative blurs */}
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-blush/20 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-md px-6"
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <Link href="/" className="font-serif text-2xl font-bold text-charcoal">
            The Social Seen
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-charcoal/5 bg-white p-8 shadow-xl shadow-charcoal/5 md:p-10">
          <div className="mb-8 text-center">
            <h1 className="font-serif text-3xl font-bold text-charcoal">
              Welcome Back
            </h1>
            <p className="mt-2 font-sans text-sm text-charcoal/50">
              Sign in to access your events and community
            </p>
          </div>

          {/* Google sign in */}
          <button
            type="button"
            className="mb-6 flex w-full items-center justify-center gap-3 rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm font-medium text-charcoal transition-all hover:border-charcoal/20 hover:bg-charcoal/[0.02]"
          >
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-charcoal/10" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-4 font-sans text-xs uppercase tracking-wider text-charcoal/30">
                or sign in with email
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSignIn} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/30" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={cn(
                    "w-full rounded-xl border bg-white py-3 pl-11 pr-4 font-sans text-sm text-charcoal outline-none transition-all",
                    "placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20",
                    errors.email
                      ? "border-red-400 ring-2 ring-red-100"
                      : "border-charcoal/10"
                  )}
                />
              </div>
              {errors.email && (
                <p className="font-sans text-xs text-red-500">
                  Please enter your email
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-sans text-sm font-medium text-charcoal/70">
                  Password
                </label>
                <button
                  type="button"
                  className="font-sans text-xs text-gold transition-colors hover:text-gold/80"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/30" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className={cn(
                    "w-full rounded-xl border bg-white py-3 pl-11 pr-11 font-sans text-sm text-charcoal outline-none transition-all",
                    "placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20",
                    errors.password
                      ? "border-red-400 ring-2 ring-red-100"
                      : "border-charcoal/10"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-charcoal/30 transition-colors hover:text-charcoal/60"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="font-sans text-xs text-red-500">
                  Please enter your password
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full rounded-xl bg-gold py-3 font-sans text-sm font-semibold uppercase tracking-wider text-charcoal transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
            >
              Sign In
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center font-sans text-sm text-charcoal/40">
          Don&apos;t have an account?{" "}
          <Link
            href="/join"
            className="font-medium text-gold transition-colors hover:text-gold/80"
          >
            Join us
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
