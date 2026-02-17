import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spending Tracker",
    short_name: "SpendTrack",
    description: "Track spending, budgets, and trends in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f3f9",
    theme_color: "#5a58f2",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/apple-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
