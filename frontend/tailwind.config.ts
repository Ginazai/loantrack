import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'Courier Prime'", "Courier New", "monospace"],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        // "Promissory Note" — private ledger aesthetic
        ledger: {
          "color-scheme": "light",
          // Backgrounds: cool blue-grey (not warm cream)
          "base-100": "#F4F6FA",   // card white-blue
          "base-200": "#E8ECF4",   // page background
          "base-300": "#D0D7E8",   // dividers
          "base-content": "#1A1F2E", // near-ink text
          // Primary: slate-navy (trust, formality)
          "primary": "#2B4590",
          "primary-content": "#FFFFFF",
          // Secondary: steel-teal (transactions)
          "secondary": "#1A7A6E",
          "secondary-content": "#FFFFFF",
          // Accent: warm amber-gold (money)
          "accent": "#B8862A",
          "accent-content": "#FFFFFF",
          // Neutral: deep slate sidebar
          "neutral": "#1C2A40",
          "neutral-content": "#C8D4E8",
          // Semantic
          "info": "#3B72B5",
          "info-content": "#FFFFFF",
          "success": "#1A7A4C",
          "success-content": "#FFFFFF",
          "warning": "#C47A1A",
          "warning-content": "#FFFFFF",
          "error": "#A12828",
          "error-content": "#FFFFFF",
          "--rounded-box": "0.5rem",
          "--rounded-btn": "0.375rem",
          "--rounded-badge": "0.25rem",
        },
        // Dark variant: inked ledger at night
        ledger_dark: {
          "color-scheme": "dark",
          "base-100": "#1E2A3A",
          "base-200": "#172030",
          "base-300": "#111826",
          "base-content": "#C8D8F0",
          "primary": "#4A78D4",
          "primary-content": "#FFFFFF",
          "secondary": "#2AA890",
          "secondary-content": "#FFFFFF",
          "accent": "#D4A843",
          "accent-content": "#1A1204",
          "neutral": "#0F1826",
          "neutral-content": "#8AAACE",
          "info": "#5B9BD5",
          "info-content": "#FFFFFF",
          "success": "#2A9A60",
          "success-content": "#FFFFFF",
          "warning": "#D48B24",
          "warning-content": "#FFFFFF",
          "error": "#C43A3A",
          "error-content": "#FFFFFF",
          "--rounded-box": "0.5rem",
          "--rounded-btn": "0.375rem",
          "--rounded-badge": "0.25rem",
        },
      },
    ],
    defaultTheme: "ledger",
    darkTheme: "ledger_dark",
  },
} satisfies Config;
