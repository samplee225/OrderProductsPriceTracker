# OrderCalc

## MongoDB Atlas Order Saving

1. Create a MongoDB Atlas cluster and database user.
2. Copy `.env.example` to `.env`.
3. Put your Atlas connection string in `MONGODB_URI`.
4. Install and start:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Orders still save in the browser first. When the server is running, the app also syncs them to MongoDB Atlas through:

- `GET /api/orders/:clientId`
- `PUT /api/orders/:clientId`

## Production / Deployment notes

Recommended environment variables:

- `MONGODB_URI` — MongoDB Atlas connection string (required)
- `PORT` — port to listen on (defaults to `3000`)
- `NODE_ENV` — set to `production` in production
- `CORS_ORIGIN` — optional comma-separated list of allowed origins

Install dependencies and start:

```bash
npm install
npm start
```

For development with auto-reload:

```bash
npm run dev
```

Notes:

- The server enables HTTP caching for static assets and applies basic security hardening (Helmet), compression, request logging and a rate limiter.
- Keep your `.env` file out of git (see `.gitignore`).
- For production use a process manager (PM2, systemd) or a container platform and ensure `NODE_ENV=production` is set.
