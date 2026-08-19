.PHONY: install install-consumer install-dashboard install-kitchen install-backend \
        dev-consumer dev-dashboard dev-kitchen dev-backend \
        build build-consumer build-dashboard build-kitchen \
        migrate migrate-undo seed db-create \
        verify-schema healthcheck verify setup \
        gen-api gen-spec gen-api-consumer gen-api-dashboard gen-api-kitchen \
        clean

# ---- Install ----

install: install-backend install-consumer install-dashboard install-kitchen

install-backend:
	cd backend && npm install

install-consumer:
	cd consumer && npm install

install-dashboard:
	cd dashboard && npm install

install-kitchen:
	cd kitchen && npm install

# ---- Dev servers (run each in its own terminal) ----

dev-backend:
	cd backend && npm run dev

dev-consumer:
	cd consumer && npm run dev

dev-dashboard:
	cd dashboard && npm run dev

dev-kitchen:
	cd kitchen && npm run dev

# ---- Production builds ----

build: build-consumer build-dashboard build-kitchen

build-consumer:
	cd consumer && npm run build

build-dashboard:
	cd dashboard && npm run build

build-kitchen:
	cd kitchen && npm run build

# ---- Database (Sequelize) ----

db-create:
	cd backend && npx sequelize-cli db:create

migrate:
	cd backend && npx sequelize-cli db:migrate

migrate-undo:
	cd backend && npx sequelize-cli db:migrate:undo

seed:
	cd backend && npx sequelize-cli db:seed:all

# ---- Verification ----
# verify-schema: models, associations, Sequelize init (run after migrating).
# healthcheck:   deployment readiness - connection, migrations, seeds, env vars.

verify-schema:
	cd backend && npm run verify-schema

healthcheck:
	cd backend && npm run healthcheck

verify:
	cd backend && npm run verify-schema
	cd backend && npm run healthcheck

# ---- First-time setup ----
# Installs, creates the database, migrates, seeds, then verifies.

setup:
	cd backend && npm install
	cd backend && npx sequelize-cli db:create
	cd backend && npx sequelize-cli db:migrate
	cd backend && npx sequelize-cli db:seed:all
	cd backend && npm run verify-schema
	cd backend && npm run healthcheck

# ---- API client generation ----
# Run this after changing/adding backend routes to keep frontend API calls in sync.

gen-api: gen-spec gen-api-consumer gen-api-dashboard gen-api-kitchen

gen-spec:
	cd backend && npm run gen:spec

gen-api-consumer:
	cd consumer && npm run gen:api

gen-api-dashboard:
	cd dashboard && npm run gen:api

gen-api-kitchen:
	cd kitchen && npm run gen:api

# ---- Cleanup ----

clean:
	rm -rf backend/node_modules consumer/node_modules dashboard/node_modules kitchen/node_modules
	rm -rf consumer/dist dashboard/dist kitchen/dist