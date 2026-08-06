# QBusto - Cinema Food Ordering & Management Platform

A multi-tenant platform for cinema chains to run in-seat and lobby food ordering, with
role-based management dashboards and a kitchen order board.

## Structure

```
/consumer   → customer-facing ordering site (React + Vite + SCSS)
/dashboard  → admin / chain / cinema / owner management (React + Vite + antd)
/kitchen    → kitchen display board (React + Vite + SCSS)
/backend    → API server (Express + Sequelize + SQL Server)
```

## Stack

| Layer         | Tech                                                        |
| ------------- | ----------------------------------------------------------- |
| Consumer site | React, Vite, SCSS Modules, Axios, Zustand                   |
| Dashboard     | React, Vite, Ant Design                                     |
| Kitchen       | React, Vite, SCSS (polls the backend, no server of its own) |
| Backend       | Node.js, Express, Sequelize                                 |
| Database      | SQL Server                                                  |
| Payments      | Razorpay                                                    |
| Hosting       | Local server                                                |

## Prerequisites

- Node.js (LTS)
- SQL Server running locally (Express edition is free)
- A Razorpay account (test keys for development)

## Getting started

1. Clone the repo and install everything:

   ```bash
   make install
   ```

2. Create a `.env` file inside `backend/` with your database and Razorpay credentials:

   ```
   DB_HOST=localhost
   DB_PORT=1433
   DB_NAME=cinema_ordering
   DB_USER=sa
   DB_PASSWORD=your_password

   JWT_SECRET=your_jwt_secret

   RAZORPAY_KEY_ID=your_key_id
   RAZORPAY_KEY_SECRET=your_key_secret
   ```

3. Create the database and run migrations:

   ```bash
   make db-create
   make migrate
   ```

4. Run each app in its own terminal:
   ```bash
   make dev-backend
   make dev-consumer
   make dev-dashboard
   make dev-kitchen
   ```

## Keeping frontend API calls in sync with the backend

Backend routes are documented with OpenAPI (Swagger) JSDoc comments. Whenever you add or
change a route, regenerate the shared spec and the frontend API clients:

```bash
make gen-api
```

This writes `shared/openapi.json` from the backend's route annotations, then regenerates
Axios call functions in `consumer`, `dashboard`, and `kitchen` (via Orval) - so you
never hand-write or manually update API call code after a backend change.

## Building for production

```bash
make build
```

Builds `consumer`, `dashboard`, and `kitchen` into their respective `dist/` folders,
ready to be served from the local server alongside the running `backend` API.

## Notes

- Multi-tenancy is handled at the row level (`chainId` / `cinemaId` columns), not via
  separate databases per tenant.
- The kitchen board has no backend of its own - it reads and updates orders through the
  same `/orders` endpoints the dashboard uses, polling every 5-10 seconds.
- The consumer order flow is intentionally simple: browse → cart → checkout → Razorpay
  payment → confirmation. No order editing, cancellation, or status tracking on the
  customer side.
