import type { Metadata } from "next";
import { headers } from "next/headers";
import { Playfair_Display, DM_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "The Social Seen | Where Connections Become Stories",
  description:
    "A curated community for those who believe the best moments are experienced together. Discover handpicked social events -- wine tastings, supper clubs, gallery openings, and cultural soirees.",
  keywords: [
    "social events",
    "curated experiences",
    "luxury events",
    "wine tastings",
    "supper clubs",
    "gallery openings",
    "networking",
    "community",
  ],
  authors: [{ name: "The Social Seen" }],
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "https://thesocialseen.com",
    siteName: "The Social Seen",
    title: "The Social Seen | Where Connections Become Stories",
    description:
      "A curated community for those who believe the best moments are experienced together. Discover handpicked social events and unforgettable experiences.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "The Social Seen - Curated Social Events",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Social Seen | Where Connections Become Stories",
    description:
      "A curated community for those who believe the best moments are experienced together.",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${playfair.variable} ${dmSans.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          {!isAdmin && <Header />}
          <main>{children}</main>
          {!isAdmin && <Footer />}
        </ThemeProvider>
      </body>
    </html>
  );
}
