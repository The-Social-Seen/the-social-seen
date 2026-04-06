import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        // Supabase Storage — replace with your actual project ref hostname
        // e.g. omabvqhvcdzngeiriiii.supabase.co
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "res.dayoutwiththekids.co.uk",
      },
    ],
  },
};

export default nextConfig;
