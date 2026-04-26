/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Linear-inspired palette
        bg: {
          primary: "#08090a",
          secondary: "#0f1011",
          tertiary: "#16181c",
          elevated: "#1c1f23",
        },
        border: {
          DEFAULT: "#23262d",
          strong: "#2e323a",
        },
        text: {
          primary: "#f7f8f8",
          secondary: "#b4bcd0",
          tertiary: "#8a8f98",
          muted: "#62666d",
        },
        accent: {
          DEFAULT: "#5e6ad2",
          hover: "#7170ff",
          subtle: "rgba(94, 106, 210, 0.12)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        xs: ["11px", "16px"],
        sm: ["12px", "18px"],
        base: ["13px", "20px"],
        md: ["14px", "21px"],
        lg: ["15px", "22px"],
      },
      boxShadow: {
        elevated:
          "0 0 0 1px rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
};
