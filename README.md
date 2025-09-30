<a href="https://chat.vercel.ai/">
  <img alt="Next.js 14 and App Router-ready AI chatbot." src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chat SDK</h1>
</a>

<p align="center">
    Chat SDK is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chat-sdk.dev"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#finance-tooling"><strong>Finance Tooling</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports xAI (default), OpenAI, Fireworks, and other model providers
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Auth.js](https://authjs.dev)
  - Simple and secure authentication

## Model Providers

This template uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access multiple AI models through a unified interface. The default configuration includes [xAI](https://x.ai) models (`grok-2-vision-1212`, `grok-3-mini`) routed through the gateway.

### AI Gateway Authentication

**For Vercel deployments**: Authentication is handled automatically via OIDC tokens.

**For non-Vercel deployments**: You need to provide an AI Gateway API key by setting the `AI_GATEWAY_API_KEY` environment variable in your `.env.local` file.

With the [AI SDK](https://ai-sdk.dev/docs/introduction), you can also switch to direct LLM providers like [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Cohere](https://cohere.com/), and [many more](https://ai-sdk.dev/providers/ai-sdk-providers) with just a few lines of code.

## Deploy Your Own

You can deploy your own version of the Next.js AI Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/nextjs-ai-chatbot)

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Next.js AI Chatbot. It's recommended you use [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables) for this, but a `.env` file is all that is necessary.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various AI and authentication provider accounts.

1. Install Vercel CLI: `npm i -g vercel`
2. Link local instance with Vercel and GitHub accounts (creates `.vercel` directory): `vercel link`
3. Download your environment variables: `vercel env pull`

```bash
pnpm install
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000).

## Finance Tooling

The project ships with an offline-friendly finance assistant that can stream interactive artefacts for charts, backtests, fundamentals, and news. Key points:

- **Enable the feature** by setting `FEATURE_FINANCE=true` in your environment. The assistant also requires `OPENAI_API_KEY` and a valid `OPENAI_MODEL_ID` (see `.env.example`).
- **No live market calls** occur during development or CI. Mock datasets under `lib/finance/mock-data.ts` and deterministic seeds populate the catalogue. When you want to plug in a real provider, set `FEATURE_USE_REAL_DATA=true` alongside `MARKET_DATA_API_BASE_URL` and `MARKET_DATA_API_KEY`; the server automatically falls back to mocks if either value is missing.
- **Artefact renderers** live in `components/finance/*` and consume the JSON payloads documented in [`docs/finance/artifacts.md`](docs/finance/artifacts.md).
- **API endpoints** exposed under `/api/finance/*` are validated with Zod, rate-limited, and described in [`docs/finance/api.md`](docs/finance/api.md).
- **Backtesting assumptions** (slippage, commission, metrics) are explained in [`docs/finance/backtest.md`](docs/finance/backtest.md).
- **Risk disclaimer**: the assistant provides educational analysis only—it does **not** constitute personalised financial advice. Always verify outputs against authoritative sources before taking action.

### Finance slash commands

To speed up exploration, the chat input recognises a couple of finance-specific shortcuts:

- `/chart BTCUSD 1D` rewrites into an explicit request for a `finance.chart` artefact covering the BTCUSD pair on daily candles. Append any indicator hints (for example `SMA(50/200)`) after the timeframe to have them echoed in the assistant instructions.
- `/backtest AAPL 2018-01-01 2020-12-31 50 200` expands to a request for an SMA crossover backtest between the supplied dates. If you omit the moving-average windows the helper falls back to the default 50/200 configuration.

Each shortcut still runs through the offline datasets and carries the same non-advisory language enforced across the finance toolkit.

## Production & Vercel configuration

Deployments on Vercel (or any long-lived environment) must provide the same hermetic guarantees as local development. Before pushing a new build, double-check the following configuration:

- **Environment variables**: define `AUTH_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL_ID`, `POSTGRES_URL`, and `BLOB_READ_WRITE_TOKEN`. The finance artefacts also rely on optional mocks that can source external providers if you later enable them—set `MARKET_DATA_API_KEY`, `MARKET_DATA_API_BASE_URL`, and `NEWS_API_KEY` if you connect to live feeds. Flip `FEATURE_USE_REAL_DATA=true` to activate the HTTP adapter.
- **Feature flags**: keep `FEATURE_FINANCE=true` to enable charting, fundamentals, and backtesting endpoints alongside the system prompt updates documented above.
- **Database readiness**: the build pipeline (and the provided GitHub Actions workflow) runs `pnpm db:migrate` followed by `pnpm db:seed` before executing `pnpm build`. Reproduce that order locally when preparing environment snapshots.
- **Health check**: expose a lightweight probe by hitting [`/api/finance/quote?symbol=BTCUSD`](app/api/finance/quote/route.ts). The endpoint serves deterministic offline data when external APIs are unavailable, making it safe for uptime monitors.

These steps ensure every deployment respects the offline-friendly finance mocks and migration ordering required by the CI pipeline.
