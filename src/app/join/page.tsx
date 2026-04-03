"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  User,
  Briefcase,
  Heart,
  MessageSquare,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { allInterests } from "@/data/members";
import { brandPalette } from "@/config/design-tokens";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STEPS = [
  { label: "Account", icon: User },
  { label: "About You", icon: Briefcase },
  { label: "Interests", icon: Heart },
  { label: "Final Details", icon: MessageSquare },
  { label: "Welcome", icon: PartyPopper },
];

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Legal",
  "Marketing",
  "Design",
  "Media",
  "Consulting",
  "Architecture",
  "Health",
  "Food & Beverage",
  "Venture Capital",
  "Other",
];

const HEAR_ABOUT_OPTIONS = [
  "Friend",
  "Instagram",
  "LinkedIn",
  "Event",
  "Other",
];

const SIDE_IMAGES = [
  "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=900&q=80",
  "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=80",
  "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80",
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&q=80",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=900&q=80",
];

/* ------------------------------------------------------------------ */
/*  Slide animation variants                                           */
/* ------------------------------------------------------------------ */

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

/* ------------------------------------------------------------------ */
/*  Confetti Burst (Step 5 celebration)                                */
/* ------------------------------------------------------------------ */

function ConfettiBurst() {
  const pieces = Array.from({ length: 50 });
  const colors = brandPalette;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const duration = 1.8 + Math.random() * 1.2;
        const size = 6 + Math.random() * 8;
        const rotation = Math.random() * 360;
        const color = colors[i % colors.length];

        return (
          <motion.div
            key={i}
            className="absolute rounded-sm"
            style={{
              left: `${left}%`,
              top: "-10px",
              width: size,
              height: size,
              backgroundColor: color,
              rotate: rotation,
            }}
            initial={{ y: -20, opacity: 1 }}
            animate={{
              y: [0, 600 + Math.random() * 200],
              x: [0, (Math.random() - 0.5) * 200],
              rotate: [rotation, rotation + 360 * (Math.random() > 0.5 ? 1 : -1)],
              opacity: [1, 1, 0],
            }}
            transition={{
              duration,
              delay,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function JoinPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // Step 1
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  // Step 3
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  // Step 4
  const [hearAbout, setHearAbout] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [bio, setBio] = useState("");

  /* ---- validation ---- */
  function validate(): boolean {
    const newErrors: Record<string, boolean> = {};

    if (step === 0) {
      if (!name.trim()) newErrors.name = true;
      if (!email.trim()) newErrors.email = true;
      if (!password.trim()) newErrors.password = true;
    }
    if (step === 1) {
      if (!jobTitle.trim()) newErrors.jobTitle = true;
      if (!company.trim()) newErrors.company = true;
      if (!industry) newErrors.industry = true;
    }
    if (step === 2) {
      if (selectedInterests.length === 0) newErrors.interests = true;
    }
    if (step === 3) {
      if (!hearAbout) newErrors.hearAbout = true;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function next() {
    if (!validate()) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    setErrors({});
  }

  function back() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
    setErrors({});
  }

  function toggleInterest(interest: string) {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  }

  /* ---- Input component ---- */
  function Input({
    label,
    value,
    onChange,
    type = "text",
    placeholder,
    errorKey,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
    errorKey?: string;
  }) {
    const hasError = errorKey && errors[errorKey];
    return (
      <div className="space-y-2">
        <label className="block font-sans text-sm font-medium text-charcoal/70">
          {label}
        </label>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-xl border bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all",
            "placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20",
            hasError ? "border-red-400 ring-2 ring-red-100" : "border-charcoal/10"
          )}
        />
        {hasError && (
          <p className="font-sans text-xs text-red-500">This field is required</p>
        )}
      </div>
    );
  }

  /* ---- Select component ---- */
  function Select({
    label,
    value,
    onChange,
    options,
    placeholder,
    errorKey,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: string[];
    placeholder: string;
    errorKey?: string;
  }) {
    const hasError = errorKey && errors[errorKey];
    return (
      <div className="space-y-2">
        <label className="block font-sans text-sm font-medium text-charcoal/70">
          {label}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full appearance-none rounded-xl border bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all",
            "focus:border-gold focus:ring-2 focus:ring-gold/20",
            hasError ? "border-red-400 ring-2 ring-red-100" : "border-charcoal/10",
            !value && "text-charcoal/30"
          )}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {hasError && (
          <p className="font-sans text-xs text-red-500">Please select an option</p>
        )}
      </div>
    );
  }

  /* ---- Step renderers ---- */
  function renderStep() {
    switch (step) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="mb-2">
              <h2 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
                Let&apos;s Get Started
              </h2>
              <p className="mt-2 font-sans text-sm text-charcoal/50">
                Create your account to join London&apos;s most exciting social
                community.
              </p>
            </div>
            <Input
              label="Full Name"
              value={name}
              onChange={setName}
              placeholder="Charlotte Moreau"
              errorKey="name"
            />
            <Input
              label="Email Address"
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="charlotte@example.com"
              errorKey="email"
            />
            <Input
              label="Password"
              value={password}
              onChange={setPassword}
              type="password"
              placeholder="At least 8 characters"
              errorKey="password"
            />
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="mb-2">
              <h2 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
                Tell Us About You
              </h2>
              <p className="mt-2 font-sans text-sm text-charcoal/50">
                Help us match you with the right events and people.
              </p>
            </div>
            <Input
              label="Job Title"
              value={jobTitle}
              onChange={setJobTitle}
              placeholder="Marketing Director"
              errorKey="jobTitle"
            />
            <Input
              label="Company"
              value={company}
              onChange={setCompany}
              placeholder="Ogilvy"
              errorKey="company"
            />
            <Select
              label="Industry"
              value={industry}
              onChange={setIndustry}
              options={INDUSTRIES}
              placeholder="Select your industry"
              errorKey="industry"
            />
            <Input
              label="LinkedIn URL (optional)"
              value={linkedinUrl}
              onChange={setLinkedinUrl}
              placeholder="https://linkedin.com/in/yourname"
            />
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="mb-2">
              <h2 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
                What Are You Into?
              </h2>
              <p className="mt-2 font-sans text-sm text-charcoal/50">
                Select the interests that resonate with you. We&apos;ll use these
                to curate your experience.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {allInterests.map((interest) => {
                const isSelected = selectedInterests.includes(interest);
                return (
                  <button
                    key={interest}
                    onClick={() => toggleInterest(interest)}
                    className={cn(
                      "rounded-full border px-5 py-2.5 font-sans text-sm font-medium transition-all duration-200",
                      isSelected
                        ? "border-gold bg-gold text-charcoal shadow-md shadow-gold/20"
                        : "border-charcoal/15 bg-white text-charcoal/60 hover:border-gold/50 hover:text-charcoal"
                    )}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
            {errors.interests && (
              <p className="font-sans text-xs text-red-500">
                Please select at least one interest
              </p>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="mb-2">
              <h2 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
                Almost There
              </h2>
              <p className="mt-2 font-sans text-sm text-charcoal/50">
                Just a couple more details and you&apos;re in.
              </p>
            </div>
            <Select
              label="How did you hear about us?"
              value={hearAbout}
              onChange={setHearAbout}
              options={HEAR_ABOUT_OPTIONS}
              placeholder="Select an option"
              errorKey="hearAbout"
            />
            <Input
              label="Referral Code (optional)"
              value={referralCode}
              onChange={setReferralCode}
              placeholder="e.g. SOCIAL2026"
            />
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Short Bio (optional)
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us a bit about yourself..."
                rows={4}
                className={cn(
                  "w-full resize-none rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all",
                  "placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20"
                )}
              />
            </div>
          </div>
        );

      case 4:
        return (
          <div className="relative flex flex-col items-center justify-center py-8 text-center">
            <ConfettiBurst />

            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 15,
                delay: 0.2,
              }}
              className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gold/10"
            >
              <Sparkles className="h-12 w-12 text-gold" />
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mb-3 font-serif text-3xl font-bold text-charcoal md:text-4xl"
            >
              Welcome to The Social Seen
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mb-2 font-sans text-charcoal/50"
            >
              Your membership is confirmed.
            </motion.p>

            {name && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="mb-8 font-sans text-lg font-medium text-charcoal"
              >
                Welcome, {name}!
              </motion.p>
            )}

            {/* Avatar placeholder */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-gold/20 font-serif text-2xl font-bold text-gold"
            >
              {name
                ? name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                : "SS"}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="flex flex-col gap-3 sm:flex-row"
            >
              <Link
                href="/profile"
                className="inline-flex items-center justify-center rounded-full bg-gold px-8 py-3 font-sans text-sm font-semibold uppercase tracking-wider text-charcoal transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
              >
                Go to Your Profile
              </Link>
              <Link
                href="/events"
                className="inline-flex items-center justify-center rounded-full border-2 border-gold px-8 py-3 font-sans text-sm font-semibold uppercase tracking-wider text-gold transition-all hover:bg-gold/10"
              >
                Explore Events
              </Link>
            </motion.div>
          </div>
        );

      default:
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex min-h-screen bg-cream">
      {/* ---- Left: Form Side ---- */}
      <div className="flex w-full flex-col lg:w-1/2">
        {/* Top nav */}
        <div className="flex items-center justify-between px-6 py-6 md:px-12">
          <Link
            href="/"
            className="font-serif text-xl font-bold text-charcoal"
          >
            The Social Seen
          </Link>
          <Link
            href="/login"
            className="font-sans text-sm text-charcoal/50 transition-colors hover:text-gold"
          >
            Already a member? <span className="font-medium text-gold">Sign In</span>
          </Link>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-4 md:px-12">
          <div className="flex items-center justify-center gap-0">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center">
                {/* Circle */}
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 font-sans text-sm font-semibold transition-all duration-300",
                    i < step
                      ? "border-gold bg-gold text-charcoal"
                      : i === step
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-charcoal/10 bg-white text-charcoal/30"
                  )}
                >
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 w-8 transition-all duration-300 md:w-14",
                      i < step ? "bg-gold" : "bg-charcoal/10"
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          {/* Step label */}
          <p className="mt-3 text-center font-sans text-xs font-medium uppercase tracking-widest text-charcoal/40">
            Step {step + 1} of {STEPS.length} &mdash; {STEPS[step].label}
          </p>
        </div>

        {/* Form content */}
        <div className="flex flex-1 items-start px-6 py-6 md:items-center md:px-12 lg:px-16">
          <div className="w-full max-w-lg mx-auto">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            {step < 4 && (
              <div className="mt-10 flex items-center justify-between">
                {step > 0 ? (
                  <button
                    onClick={back}
                    className="inline-flex items-center gap-2 font-sans text-sm font-medium text-charcoal/50 transition-colors hover:text-charcoal"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                ) : (
                  <div />
                )}
                <button
                  onClick={next}
                  className="inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3 font-sans text-sm font-semibold uppercase tracking-wider text-charcoal transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
                >
                  {step === 3 ? "Complete Sign Up" : "Continue"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- Right: Atmospheric Image ---- */}
      <div className="relative hidden lg:block lg:w-1/2">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${SIDE_IMAGES[step]})` }}
          >
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-cream/30 to-transparent" />
            <div className="absolute inset-0 bg-black/20" />

            {/* Decorative text at bottom */}
            <div className="absolute bottom-12 left-12 right-12">
              <p className="font-sans text-xs font-medium uppercase tracking-[0.3em] text-white/60">
                The Social Seen
              </p>
              <p className="mt-2 font-serif text-2xl font-bold text-white">
                {step === 0 && "Begin your journey"}
                {step === 1 && "Every member has a story"}
                {step === 2 && "Find your people"}
                {step === 3 && "You're almost one of us"}
                {step === 4 && "Welcome to the community"}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
