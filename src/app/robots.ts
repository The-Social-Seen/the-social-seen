import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/profile", "/bookings"],
      },
    ],
    sitemap: "https://thesocialseen.com/sitemap.xml",
  };
}
