# AirMessage for web

![AirMessage running on Microsoft Edge](README/windows-web.png)

AirMessage lets people use iMessage on the devices they like.
**AirMessage for web** brings iMessage to modern web browsers over a WebSocket proxy.
Production builds are hosted on [web.airmessage.org](https://web.airmessage.org) while the project transitions toward a BlueBubbles-first experience.

Planning your contribution? Check out the [BlueBubbles migration roadmap](project.md)
for the current status, open tasks, and future ideas.

## BlueBubbles migration updates & local development

We're in the middle of moving AirMessage Web from the legacy Connect
infrastructure to the newer BlueBubbles transport. Recent work introduced a
BlueBubbles-first onboarding flow, refreshed authentication helpers, and a REST
communications manager that powers chat load, sending, and attachment upload
against BlueBubbles servers. The [roadmap](project.md) highlights the remaining
gaps—like live updates and contact handling—and future polish items such as
search, typing indicators, and richer delivery states.

Want to explore the migration locally? Follow these steps:

1. **Clone the repository**
   ```bash
   git clone https://github.com/eliluong/airmessage-web.git
   cd airmessage-web
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure Sentry (optional)**
   If you want browser error reports locally or in production builds, provide a
   Sentry DSN before starting webpack:
   ```bash
   export SENTRY_DSN="https://examplePublicKey@o0.ingest.sentry.io/0"
   ```
   Without a DSN the app still builds and runs; Sentry initialization is simply
   skipped.
4. **Start the development server**
   ```bash
   npm start
   ```
5. **Open the app**
   Navigate to [http://localhost:8080](http://localhost:8080) to use the web
   client. When you're ready to create an optimized bundle, run `npm run build`.

BlueBubbles ecosystem projects:
[Server](https://github.com/BlueBubblesApp/bluebubbles-server) |
[Android](https://github.com/BlueBubblesApp/bluebubbles-app) |
[Desktop](https://github.com/BlueBubblesApp/bluebubbles-desktop-app)

## Getting started

To build AirMessage for web, you will need [Node.js](https://nodejs.org).

AirMessage for web uses [React](https://reactjs.org) and [TypeScript](https://www.typescriptlang.org). If you're not familiar with these tools, they both have great introductory guides:
- [React - Getting started](https://reactjs.org/docs/getting-started.html)
- [TypeScript for JavaScript Programmers](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html)

AirMessage for web no longer relies on a private configuration bundle for Sentry or Firebase. Instead, expose a Sentry DSN through the `SENTRY_DSN` environment variable before invoking webpack (for example, `SENTRY_DSN=... npm run build`). During builds the DSN is injected as `WPEnv.SENTRY_DSN`; when it is missing the application simply omits Sentry initialization.

To launch a development server, run `npm start`. To build a production-optimized bundle, run `npm run build`.

## Building and running for AirMessage Connect

In order to help developers get started quickly, we host a separate open-source version of AirMessage Connect at `connect-open.airmessage.org`.
The default configuration is pre-configured to authenticate and connect to this server.
Since this version of AirMessage Connect is hosted in a separate environment from official servers, you will have to be running a version of AirMessage Server that also connects to the same AirMessage Connect server.

We kindly ask that you do not use AirMessage's official Connect servers with any unofficial builds of AirMessage-compatible software.

---

Thank you for your interest in contributing to AirMessage and the BlueBubbles transition!
You're helping to shape the future of an open, secure messaging market.
Should you have any questions, comments, or concerns, please reach out to [support@bluebubbles.app](mailto:support@bluebubbles.app).
