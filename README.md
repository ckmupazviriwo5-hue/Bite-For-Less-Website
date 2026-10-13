# Bite For Less

Bite For Less is a food-surplus marketplace designed to help local businesses list limited-time flash deals while allowing customers to discover and reserve discounted food before it expires.

## Features

- Customer browsing and reservation system
- Shop-owner flash-deal creation and management
- Admin approval workflow for shop applications
- QR and PIN verification for pickup
- Review and rating system
- Database-backed backend with SQLite for local development
- Modern orange-on-black responsive frontend
- Prices displayed in Zambian Kwacha (ZMW); stored API values are plain numbers interpreted as ZMW

## Project structure

- `frontend/` – HTML, CSS, and JavaScript app shell
- `backend/` – Express API, routes, middleware, and SQLite setup
- `.env.example` – required environment configuration
- `README.md` – local run and deployment guide

## Local setup

1. Install Node.js 20+
2. In the project root, run:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and update the values.
4. Run the database migration/seed script:
   ```bash
   npm run migrate
   npm run seed
   ```
5. Start the backend in development mode:
   ```bash
   npm run dev
   ```
6. Open the app in a browser at:
   ```text
   http://localhost:5000
   ```

## Environment variables

The project uses a `.env` file with values such as:

```env
PORT=5000
JWT_SECRET=change_this_secret
ADMIN_EMAIL=admin@biteforless.test
ADMIN_PASSWORD=admin123
DATABASE_URL=sqlite:./backend/data/biteforless.db
NODE_ENV=development
FRONTEND_URL=http://localhost:5000
```

## Admin access

The default seeded admin is:

- Email: `admin@biteforless.test`
- Password: `admin123`

## Shop creation flow

1. Apply on the homepage under “Join as a Shop”.
2. Admin approves the application.
3. Shop owner logs in and creates a flash deal.
4. Customers reserve and pick up using QR/PIN verification.

## Customer reservation flow

1. Browse deals and click “Reserve & Get QR”.
2. The API validates availability and creates a reservation token.
3. The customer receives the reservation code, PIN, and QR token.
4. A shop owner verifies the QR/PIN on pickup.

## Deployment preparation

The project is structured so it can be deployed to a frontend host and a backend service, with PostgreSQL or another SQL database abstracted behind a configuration file.

For a production deploy:

- Move the frontend to Vercel or Netlify if needed.
- Deploy the Express API to Render, Railway, or Fly.io.
- Replace the SQLite local database with PostgreSQL in production.
- Set secure environment variables for JWT and admin credentials.

## Security notes

- Passwords are hashed using `bcryptjs`.
- JWT-based authentication is used for protected routes.
- Backend validation checks quantities, expiry dates, and ownership.
- No secrets are stored in frontend JavaScript.

## Testability

This project includes a basic Node test setup and example backend logic can be placed under a `tests/` folder for future expansion.
