import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/utils/site";

/**
 * Robots policy. Allow general crawling of public surfaces; block
 * admin tooling, API endpoints, member-only views, and auth flows
 * (which return 200 to authenticated requests but redirect or 401
 * for unauth — we don't want them indexed in either state).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/profile",
          "/bookings",
          "/account-suspended",
          "/verify",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
