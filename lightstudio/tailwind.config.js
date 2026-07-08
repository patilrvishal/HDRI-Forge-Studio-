/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'studio': {
          'deep': '#0d0d1a',
          'panel': '#12121e',
          'card': '#1a1a2e',
          'input': '#16162a',
          'accent': '#4a9eff',
          'accent-dim': '#4a9eff44',
          'accent-bg': '#4a9eff22',
          'purple': '#8b5cf6',
          'track': '#2a2a3e',
          'border': '#2a2a40',
          'border-light': '#3a3a55',
          'text': '#e8e8f0',
          'text-sec': '#9090a8',
          'text-dim': '#5a5a72',
          'danger': '#ef4444',
          'success': '#22c55e',
          'warning': '#f59e0b',
        },
      },
      fontFamily: {
        'ui': ['Inter', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'label': ['11px', { lineHeight: '14px' }],
        'panel-title': ['13px', { lineHeight: '16px', fontWeight: '600' }],
        'heading': ['14px', { lineHeight: '18px', fontWeight: '700' }],
      },
      spacing: {
        'panel-left': '220px',
        'panel-right': '320px',
        'toolbar-h': '42px',
        'bottom-h': '240px',
        'left-toolbar': '40px',
      },
      width: {
        'panel-left': '220px',
        'panel-right': '320px',
        'left-toolbar': '40px',
      },
      height: {
        'toolbar-h': '42px',
        'bottom-h': '240px',
      },
      minWidth: {
        'panel-left': '160px',
        'panel-right': '240px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-left': 'slideLeft 0.2s ease-out',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideLeft: {
          '0%': { transform: 'translateX(10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};