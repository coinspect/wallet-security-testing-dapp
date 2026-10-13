/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Wizard surface tokens used by the navigator and image viewer.
        dark: {
          base: 'rgb(24 24 27)',
          surface: 'rgb(32 32 35)',
          border: 'rgb(39 39 42)',
        },
        background: {
          light: '#f9fafb',
          dark: '#141625'
        },
        surface: {
          light: '#ffffff',
          dark: '#1e2139'
        },
        primary: {
          light: '#3b82f6',
          dark: '#4c7bff'
        },

        // Theme-aware wizard palette.
        stealth: {
          // Every surface + text token resolves through `:root` (light)
          // or `.dark` (dark). Brand colours remain static.
          bg:       'rgb(var(--stealth-bg) / <alpha-value>)',
          panel:    'rgb(var(--stealth-panel) / <alpha-value>)',
          surface:  'rgb(var(--stealth-surface) / <alpha-value>)',
          elevated: 'rgb(var(--stealth-elevated) / <alpha-value>)',
          terminal: 'rgb(var(--stealth-terminal) / <alpha-value>)',
          border:   'rgb(var(--stealth-border) / <alpha-value>)',
          subtle:   'rgb(var(--stealth-elevated) / <alpha-value>)',
          fg:       'rgb(var(--stealth-fg) / <alpha-value>)',
          muted:    'rgb(var(--stealth-muted) / <alpha-value>)',
          dim:      'rgb(var(--stealth-dim) / <alpha-value>)',
          // Brand colours — static across themes.
          action: '#3B82F6',     // cobalt — primary CTA
          actionFg: '#FFFFFF',
          accent: '#10B981',     // emerald — success
          accentFg: '#04241A',
          warn: '#F59E0B',
          danger: '#EF4444',
        },

        // ===== Shadcn HSL tokens (driven by CSS variables in globals.css) =====
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        foreground: 'hsl(var(--foreground))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(to right, #000000, #0f1218)',
      },
    },
  },
  plugins: [],
}
