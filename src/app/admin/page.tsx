"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Star,
  Bell,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  Pencil,
  Trash2,
  Download,
  Send,
  Flag,
  EyeOff,
  Search,
  Filter,
  ChevronRight,
  BarChart3,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { events, upcomingEvents, pastEvents } from "@/data/events";
import { members, industries } from "@/data/members";
import { format } from "date-fns";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Section = "overview" | "events" | "members" | "reviews" | "notifications";

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 z-50 rounded-xl border border-gold/20 bg-charcoal px-6 py-4 font-sans text-sm text-cream shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-cream/50 transition-colors hover:text-cream"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data for admin                                                */
/* ------------------------------------------------------------------ */

const allReviews = events
  .filter((e) => e.reviews && e.reviews.length > 0)
  .flatMap((e) =>
    e.reviews!.map((r) => ({
      ...r,
      eventTitle: e.title,
      eventId: e.id,
    }))
  );

const mockActivity = [
  {
    id: "a1",
    text: "Charlotte booked Wine & Wisdom",
    time: "2 hours ago",
  },
  {
    id: "a2",
    text: "New member: George Whitfield",
    time: "5 hours ago",
  },
  {
    id: "a3",
    text: "Supper Club is 85% full",
    time: "8 hours ago",
  },
  {
    id: "a4",
    text: "Emily left a 5-star review for Whisky Masterclass",
    time: "1 day ago",
  },
  {
    id: "a5",
    text: "Rooftop Yoga & Brunch published",
    time: "1 day ago",
  },
];

const mockNotifications = [
  {
    id: "n1",
    subject: "March Events Lineup",
    segment: "All Members",
    body: "Exciting news! Our March calendar is now live with 4 new events...",
    sentAt: "2026-02-20",
  },
  {
    id: "n2",
    subject: "Your waitlist update",
    segment: "Waitlisted",
    body: "Great news - a spot has opened up for Jazz & Cocktails...",
    sentAt: "2026-02-18",
  },
  {
    id: "n3",
    subject: "Supper Club Reminder",
    segment: "Event Attendees",
    body: "Just a reminder that Italian Feast is this Friday at 7:30 PM...",
    sentAt: "2026-02-15",
  },
  {
    id: "n4",
    subject: "Welcome to The Social Seen",
    segment: "All Members",
    body: "Thank you for joining our community. Here is what to expect...",
    sentAt: "2026-02-10",
  },
];

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendPositive = true,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  trend: string;
  trendPositive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-charcoal/5 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
          <Icon className="h-5 w-5 text-gold" />
        </div>
        <div
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            trendPositive
              ? "bg-green-50 text-green-600"
              : "bg-red-50 text-red-500"
          )}
        >
          {trendPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {trend}
        </div>
      </div>
      <p className="font-serif text-3xl font-bold text-charcoal">{value}</p>
      <p className="mt-1 font-sans text-xs text-charcoal/40">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini bar chart (pure CSS/divs)                                     */
/* ------------------------------------------------------------------ */

function MiniBarChart() {
  const bars = [35, 52, 48, 70, 65, 80, 60, 75, 90, 55, 68, 85];
  const months = [
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
    "Jan",
    "Feb",
  ];

  return (
    <div className="rounded-2xl border border-charcoal/5 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-sans text-sm font-semibold text-charcoal">
            Monthly Bookings
          </h3>
          <p className="font-sans text-xs text-charcoal/40">Last 12 months</p>
        </div>
        <BarChart3 className="h-5 w-5 text-charcoal/20" />
      </div>
      <div className="flex items-end gap-2">
        {bars.map((h, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-gold/70 transition-all hover:bg-gold"
              style={{ height: `${h}px` }}
            />
            <span className="font-sans text-[10px] text-charcoal/30">
              {months[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Admin Page                                                    */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const [section, setSection] = useState<Section>("overview");
  const [toast, setToast] = useState<string | null>(null);

  /* Members search & filter */
  const [memberSearch, setMemberSearch] = useState("");
  const [memberIndustry, setMemberIndustry] = useState("");

  /* Reviews filter */
  const [reviewEventFilter, setReviewEventFilter] = useState("");

  /* Notifications compose */
  const [notifSegment, setNotifSegment] = useState("All Members");
  const [notifSubject, setNotifSubject] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifTemplate, setNotifTemplate] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  /* Filtered members */
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchesSearch =
        !memberSearch ||
        m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.company.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.jobTitle.toLowerCase().includes(memberSearch.toLowerCase());
      const matchesIndustry =
        !memberIndustry || m.industry === memberIndustry;
      return matchesSearch && matchesIndustry;
    });
  }, [memberSearch, memberIndustry]);

  /* Filtered reviews */
  const filteredReviews = useMemo(() => {
    if (!reviewEventFilter) return allReviews;
    return allReviews.filter((r) => r.eventId === reviewEventFilter);
  }, [reviewEventFilter]);

  /* Navigation items */
  const navItems: { value: Section; label: string; icon: React.ElementType }[] = [
    { value: "overview", label: "Overview", icon: LayoutDashboard },
    { value: "events", label: "Events", icon: CalendarDays },
    { value: "members", label: "Members", icon: Users },
    { value: "reviews", label: "Reviews", icon: Star },
    { value: "notifications", label: "Notifications", icon: Bell },
  ];

  /* Events with computed status */
  const eventsWithStatus = events.map((e) => ({
    ...e,
    status: e.isPast ? "Past" : e.isPublished ? "Published" : "Draft",
  }));

  /* ------------------------------------------------------------------ */
  /*  Section Renderers                                                  */
  /* ------------------------------------------------------------------ */

  function renderOverview() {
    return (
      <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Users}
            label="Total Members"
            value="1,024"
            trend="12%"
            trendPositive
          />
          <StatCard
            icon={CalendarDays}
            label="Upcoming Events"
            value={String(upcomingEvents.length)}
            trend="3 new"
            trendPositive
          />
          <StatCard
            icon={DollarSign}
            label="Revenue This Month"
            value="&pound;2,450"
            trend="8%"
            trendPositive
          />
          <StatCard
            icon={Star}
            label="Avg Rating"
            value="4.7"
            trend="0.2"
            trendPositive
          />
        </div>

        {/* Chart + Activity */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <MiniBarChart />
          </div>
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-charcoal/5 bg-white p-6 shadow-sm">
              <h3 className="mb-4 font-sans text-sm font-semibold text-charcoal">
                Recent Activity
              </h3>
              <div className="space-y-4">
                {mockActivity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gold" />
                    <div className="flex-1">
                      <p className="font-sans text-sm text-charcoal/70">
                        {a.text}
                      </p>
                      <p className="font-sans text-xs text-charcoal/30">
                        {a.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderEvents() {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-serif text-2xl font-bold text-charcoal">
            All Events
          </h2>
          <button
            onClick={() => showToast("Create event coming soon")}
            className="inline-flex items-center gap-2 rounded-full bg-gold px-6 py-2.5 font-sans text-sm font-semibold text-charcoal transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
          >
            <Plus className="h-4 w-4" />
            Create Event
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-charcoal/5 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-charcoal/5 bg-charcoal/[0.02]">
                  <th className="px-6 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Title
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Date
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Category
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Price
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Capacity
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Booked
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Status
                  </th>
                  <th className="px-4 py-4 text-right font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {eventsWithStatus.map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-charcoal/[0.03] transition-colors hover:bg-gold/[0.02]"
                  >
                    <td className="px-6 py-4">
                      <p className="font-sans text-sm font-medium text-charcoal">
                        {event.title}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-sans text-sm text-charcoal/60">
                      {format(new Date(event.dateTime), "d MMM yyyy")}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-gold/10 px-3 py-1 font-sans text-xs font-medium text-gold">
                        {event.category}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {event.price === 0 ? "Free" : `\u00A3${event.price}`}
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {event.capacity}
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {event.attendeeCount}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 font-sans text-xs font-medium",
                          event.status === "Published" &&
                            "bg-green-50 text-green-600",
                          event.status === "Past" &&
                            "bg-charcoal/5 text-charcoal/40",
                          event.status === "Draft" &&
                            "bg-yellow-50 text-yellow-600"
                        )}
                      >
                        {event.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => showToast("Edit event coming soon")}
                          className="rounded-lg p-2 text-charcoal/30 transition-colors hover:bg-charcoal/5 hover:text-charcoal"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => showToast("Delete event coming soon")}
                          className="rounded-lg p-2 text-charcoal/30 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderMembers() {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-serif text-2xl font-bold text-charcoal">
            Members
          </h2>
          <button
            onClick={() => showToast("CSV export coming soon")}
            className="inline-flex items-center gap-2 rounded-full border border-charcoal/10 px-5 py-2.5 font-sans text-sm font-medium text-charcoal/60 transition-all hover:border-gold hover:text-gold"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/30" />
            <input
              type="text"
              placeholder="Search members..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full rounded-xl border border-charcoal/10 bg-white py-3 pl-11 pr-4 font-sans text-sm text-charcoal outline-none transition-all placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/30" />
            <select
              value={memberIndustry}
              onChange={(e) => setMemberIndustry(e.target.value)}
              className="appearance-none rounded-xl border border-charcoal/10 bg-white py-3 pl-11 pr-10 font-sans text-sm text-charcoal outline-none transition-all focus:border-gold focus:ring-2 focus:ring-gold/20"
            >
              <option value="">All Industries</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-charcoal/5 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-charcoal/5 bg-charcoal/[0.02]">
                  <th className="px-6 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Member
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Job Title
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Company
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Industry
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Events
                  </th>
                  <th className="px-4 py-4 text-left font-sans text-xs font-medium uppercase tracking-wider text-charcoal/40">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-charcoal/[0.03] transition-colors hover:bg-gold/[0.02] cursor-pointer"
                    onClick={() => showToast(`Viewing ${member.name}'s profile`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full">
                          <Image
                            src={member.avatarUrl}
                            alt={member.name}
                            width={36}
                            height={36}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div>
                          <p className="font-sans text-sm font-medium text-charcoal">
                            {member.name}
                          </p>
                          <p className="font-sans text-xs text-charcoal/40">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {member.jobTitle}
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {member.company}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-blush/30 px-3 py-1 font-sans text-xs font-medium text-charcoal/60">
                        {member.industry}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-sans text-sm text-charcoal/60">
                      {member.eventsAttended}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-sans text-sm text-charcoal/40">
                      {format(new Date(member.joinedAt), "d MMM yyyy")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredMembers.length === 0 && (
            <div className="p-12 text-center">
              <Users className="mx-auto mb-3 h-8 w-8 text-charcoal/20" />
              <p className="font-sans text-sm text-charcoal/40">
                No members found matching your criteria.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderReviews() {
    const reviewableEvents = events.filter(
      (e) => e.reviews && e.reviews.length > 0
    );

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-serif text-2xl font-bold text-charcoal">
            Reviews
          </h2>
          <select
            value={reviewEventFilter}
            onChange={(e) => setReviewEventFilter(e.target.value)}
            className="appearance-none rounded-xl border border-charcoal/10 bg-white px-4 py-2.5 font-sans text-sm text-charcoal outline-none transition-all focus:border-gold focus:ring-2 focus:ring-gold/20"
          >
            <option value="">All Events</option>
            {reviewableEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          {filteredReviews.map((review) => (
            <div
              key={review.id}
              className="rounded-2xl border border-charcoal/5 bg-white p-6 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full">
                    <Image
                      src={review.userAvatar}
                      alt={review.userName}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="font-sans text-sm font-medium text-charcoal">
                      {review.userName}
                    </p>
                    <p className="font-sans text-xs text-charcoal/40">
                      {review.eventTitle}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={cn(
                          "h-4 w-4",
                          i < review.rating
                            ? "fill-gold text-gold"
                            : "text-charcoal/10"
                        )}
                      />
                    ))}
                  </div>
                  <span className="font-sans text-xs text-charcoal/30">
                    {format(new Date(review.createdAt), "d MMM yyyy")}
                  </span>
                </div>
              </div>
              <p className="mb-4 font-sans text-sm leading-relaxed text-charcoal/60">
                {review.reviewText}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => showToast("Review flagged for review")}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-xs text-charcoal/40 transition-colors hover:bg-yellow-50 hover:text-yellow-600"
                >
                  <Flag className="h-3.5 w-3.5" />
                  Flag
                </button>
                <button
                  onClick={() => showToast("Review hidden")}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-xs text-charcoal/40 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderNotifications() {
    return (
      <div className="space-y-8">
        {/* Compose */}
        <div className="rounded-2xl border border-charcoal/5 bg-white p-6 shadow-sm md:p-8">
          <h2 className="mb-6 font-serif text-2xl font-bold text-charcoal">
            Compose Notification
          </h2>

          <div className="space-y-5">
            {/* Segment */}
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Recipient Segment
              </label>
              <select
                value={notifSegment}
                onChange={(e) => setNotifSegment(e.target.value)}
                className="w-full appearance-none rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                <option>All Members</option>
                <option>Event Attendees</option>
                <option>Waitlisted</option>
              </select>
            </div>

            {/* Template */}
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Template (optional)
              </label>
              <select
                value={notifTemplate}
                onChange={(e) => setNotifTemplate(e.target.value)}
                className="w-full appearance-none rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                <option value="">No template</option>
                <option value="event_reminder">Event Reminder</option>
                <option value="welcome">Welcome Message</option>
                <option value="waitlist_update">Waitlist Update</option>
                <option value="newsletter">Monthly Newsletter</option>
              </select>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Subject
              </label>
              <input
                type="text"
                value={notifSubject}
                onChange={(e) => setNotifSubject(e.target.value)}
                placeholder="Notification subject..."
                className="w-full rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>

            {/* Body */}
            <div className="space-y-2">
              <label className="block font-sans text-sm font-medium text-charcoal/70">
                Body
              </label>
              <textarea
                value={notifBody}
                onChange={(e) => setNotifBody(e.target.value)}
                placeholder="Write your message..."
                rows={5}
                className="w-full resize-none rounded-xl border border-charcoal/10 bg-white px-4 py-3 font-sans text-sm text-charcoal outline-none transition-all placeholder:text-charcoal/30 focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>

            <button
              onClick={() => {
                showToast("Notification sent!");
                setNotifSubject("");
                setNotifBody("");
                setNotifTemplate("");
              }}
              className="inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3 font-sans text-sm font-semibold text-charcoal transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
            >
              <Send className="h-4 w-4" />
              Send Notification
            </button>
          </div>
        </div>

        {/* Recent notifications */}
        <div>
          <h3 className="mb-4 font-sans text-sm font-semibold text-charcoal">
            Recently Sent
          </h3>
          <div className="space-y-3">
            {mockNotifications.map((notif) => (
              <div
                key={notif.id}
                className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/10">
                      <Bell className="h-4 w-4 text-gold" />
                    </div>
                    <div>
                      <p className="font-sans text-sm font-medium text-charcoal">
                        {notif.subject}
                      </p>
                      <p className="font-sans text-xs text-charcoal/40">
                        Sent to: {notif.segment}
                      </p>
                    </div>
                  </div>
                  <span className="font-sans text-xs text-charcoal/30">
                    {format(new Date(notif.sentAt), "d MMM yyyy")}
                  </span>
                </div>
                <p className="font-sans text-sm text-charcoal/50">
                  {notif.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex min-h-screen">
      {/* ---- Sidebar ---- */}
      <aside className="fixed left-0 top-[73px] z-30 hidden h-[calc(100vh-73px)] w-64 flex-col border-r border-border-light bg-bg-card lg:flex">
        {/* Sidebar header */}
        <div className="px-6 py-5">
          <p className="font-serif text-lg font-bold text-text-primary">
            Admin Dashboard
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.value;
              return (
                <li key={item.value}>
                  <button
                    onClick={() => setSection(item.value)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-4 py-3 font-sans text-sm font-medium transition-all",
                      isActive
                        ? "bg-charcoal text-cream shadow-sm"
                        : "text-charcoal/50 hover:bg-charcoal/[0.03] hover:text-charcoal"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                    {isActive && (
                      <ChevronRight className="ml-auto h-4 w-4 text-cream/40" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom */}
        <div className="border-t border-charcoal/5 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 overflow-hidden rounded-full border-2 border-gold/20">
              <Image
                src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80"
                alt="Admin"
                width={36}
                height={36}
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="font-sans text-sm font-medium text-charcoal">
                Sophia Laurent
              </p>
              <p className="font-sans text-xs text-charcoal/40">Co-Founder</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ---- Mobile top nav ---- */}
      <div className="border-b border-border-light bg-bg-card lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-serif text-lg font-bold text-text-primary">Admin Dashboard</span>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = section === item.value;
            return (
              <button
                key={item.value}
                onClick={() => setSection(item.value)}
                className={cn(
                  "flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-sans text-xs font-medium transition-all",
                  isActive
                    ? "bg-charcoal text-cream"
                    : "text-charcoal/40 hover:bg-charcoal/5"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Main Content ---- */}
      <main className="w-full pt-4 lg:ml-64 lg:pt-4">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:py-10">
          {/* Section header */}
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {section === "overview" && renderOverview()}
            {section === "events" && renderEvents()}
            {section === "members" && renderMembers()}
            {section === "reviews" && renderReviews()}
            {section === "notifications" && renderNotifications()}
          </motion.div>
        </div>
      </main>

      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}
