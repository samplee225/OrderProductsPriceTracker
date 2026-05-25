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
