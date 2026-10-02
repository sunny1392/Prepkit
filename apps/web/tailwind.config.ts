import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#18181b", soft: "#52525b", faint: "#a1a1aa" },
        brand: { DEFAULT: "#4f46e5", soft: "#eef2ff", dark: "#3730a3" },
      },
      keyframes: { pulseBar: { "0%,100%": { opacity: "0.4" }, "50%": { opacity: "1" } } },
      animation: { pulseBar: "pulseBar 1.4s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
