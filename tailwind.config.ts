import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0b0f",
          900: "#101218",
          850: "#151822",
          800: "#1b1f2b",
          700: "#252a3a",
          600: "#343a4e",
          500: "#4b5268",
          400: "#6b7389",
          300: "#98a0b5",
          200: "#c7cddc",
          100: "#e7eaf2",
        },
        accent: {
          DEFAULT: "#7c6cff",
          soft: "#9d92ff",
          dim: "#2a2547",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
