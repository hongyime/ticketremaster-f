# TicketRemaster Frontend

A modern, responsive Vue 3 frontend for the TicketRemaster ticketing platform.

## Features

### Core Functionality
- **Event Discovery** — Browse, search, and filter events by type, date, and venue
- **Seat Selection** — Interactive seat maps with real-time availability
- **Ticket Purchases** — Secure checkout with credit system and Stripe integration
- **Ticket Management** — View, transfer, and manage your tickets
- **Marketplace** — Verified resale marketplace for tickets
- **Admin Dashboard** — Event creation, user management, and analytics

### Developer Experience
- **Demo Mode** — Full UI testing without backend connection
- **TypeScript** — Full type safety with strict mode
- **i18n Support** — Internationalization (English, Spanish, French)
- **Accessibility** — WCAG 2.1 AA compliant with focus traps and screen reader support
- **Observability** — Sentry error tracking and PostHog analytics
- **API diagnostics** — Failed requests log only the HTTP method and numeric status; retries add attempt and delay metadata. Request bodies, URLs, headers and provider response payloads stay out of these logs. Silent background requests also suppress retry logs. Run `npm run test:api` for the regression checks.

### Real-time Features
- **WebSocket Updates** — Live seat availability and purchase notifications
- **Notification read budget** — Visible, online customer sessions use a 30-second fallback after each completed refresh when realtime is disconnected. Hidden/offline tabs pause HTTP notification reads and catch up on return. Overlapping refreshes share requests; logout/account changes cancel old reads. This changes notification reads only, not transfer, reservation or QR deadlines. Run `npm run test:notifications` for the lifecycle contract.
- **Session Replay** — Sentry session recording for debugging
- **Performance Monitoring** — Automatic performance tracking

## Tech Stack

- **Vue 3** — Composition API with `<script setup>`
- **TypeScript** — Strict mode with path aliases
- **Vite** — Fast build tooling and dev server
- **Pinia** — State management
- **Vue Router** — File-based routing with guards
- **Axios** — HTTP client with interceptors
- **Socket.IO Client** — Real-time WebSocket communication
- **vue-i18n** — Internationalization
- **Sentry** — Error tracking and performance monitoring
- **PostHog** — Product analytics and session recording

## Getting Started

### Prerequisites

- Node.js 20.19.0+ or 22.12.0+
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
# Required: VITE_API_BASE_URL, VITE_SENTRY_DSN, VITE_POSTHOG_API_KEY

# Start development server
npm run dev
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_BASE_URL` | Backend API URL | Yes |
| `VITE_SENTRY_DSN` | Sentry error tracking DSN | Yes |
| `VITE_POSTHOG_API_KEY` | PostHog project API key | Yes |
| `VITE_STRIPE_PUBLIC_KEY` | Stripe public key | Yes |
| `VITE_KONG_API_KEY` | Kong API gateway key | Yes |
| `VITE_WS_URL` | WebSocket server URL | No |
| `VITE_SENTRY_ENVIRONMENT` | Sentry environment name | No |
| `VITE_SENTRY_RELEASE` | Release version | No |
| `VITE_POSTHOG_HOST` | PostHog host URL | No |

### Available Scripts

```bash
# Development
npm run dev          # Start dev server at localhost:5173

# Building
npm run build        # Type-check and build for production
npm run build:skip-types  # Build without type checking

# Preview
npm run preview      # Preview production build locally

# Testing
npm run typecheck    # Run TypeScript type checking
npm run test         # Run Playwright E2E tests (Chromium only)
npm run test:ui      # Run tests with UI

# Analysis
npm run analyze      # Bundle size analysis
```

## Demo Mode

The frontend includes a comprehensive demo mode for UI development without a backend.

### Accessing Demo Mode

1. Navigate to `/demo-login` and select a role, or
2. Add `?demo=true` to any URL

Demo sessions use `sessionStorage` (not `localStorage`) and are cleared on tab close.

### Demo Accounts

| Account | Email | Role | Access Level |
|---------|-------|------|--------------|
| Demo User | `demo@ticketremaster.com` | user | Events, tickets, marketplace, transfers |
| Demo Admin | `admin@ticketremaster.com` | admin | Admin dashboard, event management |
| Demo Staff | `staff@ticketremaster.com` | staff | Staff scanner, ticket verification |

### Demo Features

- Browse events with mock data (6 events, varied types)
- View seat maps with 40 seats across sections
- Full checkout flow (simulated, no real charge)
- Credit top-up simulation (balance in sessionStorage)
- Full transfer OTP flow (any 6-digit code works)
- All 4 ticket status variants visible
- Admin and staff interfaces

### Debug Panel

A floating debug panel (bottom-right) provides tools for testing observability:
- Send test errors to Sentry
- Capture test events to PostHog
- Verify integration is working

## Project Structure

```
src/
├── api/              # API client and request interceptors
├── assets/           # Static assets (CSS, images)
├── components/       # Reusable Vue components
│   ├── common/       # AppNavbar (demo pill, logout), ToastStack, ConnectionStatus
│   ├── EventDatePicker/ # SeatGrid (accepts SeatWithInventory[])
│   ├── layout/       # Footer
│   ├── sections/     # Landing page sections
│   └── ui/           # EventCard, StatusBadge, ProfileField, Card, SearchBar
├── composables/      # Vue composables
│   ├── useAccessibility.ts
│   ├── useSellerNotifications.ts
│   ├── useToast.ts
│   └── useWebSocket.ts
├── config/           # Theme tokens
├── data/             # Static mock event data
├── locales/          # i18n translations (en, es, fr)
├── router/           # Route definitions with auth guards
├── services/         # mockData.ts — demo mode mock data + isDemoMode()
├── stores/           # Pinia stores (auth with demoLogin)
├── types/            # TypeScript type definitions (index.ts)
└── views/            # Page components
    └── app/          # All application views
```

## Deployment

### Vercel

The project is configured for Vercel deployment:

1. Connect your repository to Vercel
2. Add environment variables from `.env.example`
3. Deploy — Vercel handles the rest

### Build Output

```bash
npm run build
# Output: dist/
```

The `dist/` folder can be deployed to any static hosting.

## Observability

### Sentry Integration

- Automatic error capture
- Performance monitoring
- Session replay
- Breadcrumb logging

### PostHog Integration

- Page view tracking
- Custom event capture
- User identification
- Session recording (disabled in dev)

### Debugging

Use the debug panel to test observability:
1. Click the floating debug button
2. Use Sentry/PostHog test buttons
3. Check dashboards for test data

## Accessibility

The frontend follows WCAG 2.1 AA guidelines:

- Semantic HTML structure
- ARIA labels and roles
- Keyboard navigation
- Focus management
- Screen reader support
- Color contrast compliance

## Internationalization

Supported languages:
- English (default)
- Spanish (es)
- French (fr)

Add translations in `src/locales/`.

## Contributing

1. Create a feature branch
2. Make changes
3. Run `npm run typecheck` and `npm run test`
4. Submit a pull request

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
