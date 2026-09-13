/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep clinical-lab palette tuned for projector contrast.
        base: {
          900: "#0a0f1e",
          800: "#0e1528",
          700: "#141d38",
          600: "#1c2848",
        },
        healthy: {
          DEFAULT: "#2dd4bf",
          soft: "#5eead4",
        },
        dysbiotic: {
          DEFAULT: "#fb7185",
          soft: "#fda4af",
        },
        accent: "#818cf8",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(129, 140, 248, 0.5)",
        card: "0 10px 30px -12px rgba(0, 0, 0, 0.6)",
      },
    },
  },
  plugins: [],
};
