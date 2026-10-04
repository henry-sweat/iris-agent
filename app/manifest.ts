import type { MetadataRoute } from "next";

// A web app manifest can't switch icons by color scheme, so the installed
// home-screen icon is fixed at install time. Dark is the default here; swap
// "dark" for "light" below if you'd rather install the white icon.
const ICON_THEME = "dark" as const;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Iris",
    short_name: "Iris",
    start_url: "/",
    display: "standalone",
    background_color: ICON_THEME === "dark" ? "#09090b" : "#ffffff",
    theme_color: ICON_THEME === "dark" ? "#09090b" : "#ffffff",
    icons: [
      { src: `/icons/icon-192-${ICON_THEME}.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icons/icon-512-${ICON_THEME}.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icons/maskable-192-${ICON_THEME}.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `/icons/maskable-512-${ICON_THEME}.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
