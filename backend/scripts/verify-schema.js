#!/usr/bin/env node
/**
 * verify-schema
 *
 * Quick sanity check to run straight after `make migrate`.
 *
 * Confirms the Sequelize layer itself is healthy: the connection works, every
 * model file loaded, each model is properly initialized against the sequelize
 * instance, and every association was wired up by models/index.js.
 *
 * It does NOT inspect the live database structure - see healthcheck.js for
 * deployment-readiness checks.
 *
 * Exits 0 on success, 1 on any failure.
 */

require("dotenv").config();

const db = require("../models");

const OK = "✓";
const FAIL = "✗";

function fail(message, error) {
  console.error(`${FAIL} ${message}`);
  if (error && error.message) {
    console.error(`  ${error.message}`);
  }
  process.exit(1);
}

async function main() {
  const { sequelize } = db;

  // Keep the report readable - config/config.js leaves Sequelize's default
  // query logging on, which is useful in the app but noise here.
  sequelize.options.logging = false;

  // ---- 1. Connection ------------------------------------------------------
  try {
    await sequelize.authenticate();
  } catch (err) {
    fail(
      `Could not connect to SQL Server at ${process.env.DB_HOST}:${process.env.DB_PORT}`,
      err
    );
  }
  console.log(`${OK} Connected to SQL Server`);
  console.log("");

  // ---- 2. Models ----------------------------------------------------------
  const modelNames = Object.keys(db)
    .filter((key) => key !== "sequelize" && key !== "Sequelize")
    .sort();

  if (modelNames.length === 0) {
    fail("No models were loaded from models/. Check the loader in models/index.js.");
  }

  const brokenModels = [];

  console.log("Models:");
  for (const name of modelNames) {
    const model = db[name];
    const problems = [];

    // A correctly initialized model is bound to this sequelize instance, knows
    // its table, and has at least a primary key attribute.
    if (!model.sequelize || model.sequelize !== sequelize) {
      problems.push("not bound to the sequelize instance");
    }
    if (typeof model.getTableName !== "function" || !model.getTableName()) {
      problems.push("no table name");
    }
    if (!model.rawAttributes || Object.keys(model.rawAttributes).length === 0) {
      problems.push("no attributes defined");
    }

    if (problems.length > 0) {
      brokenModels.push({ name, problems });
      console.log(`  ${FAIL} ${name} - ${problems.join(", ")}`);
    } else {
      console.log(`  ${OK} ${model.getTableName()}`);
    }
  }
  console.log("");

  if (brokenModels.length > 0) {
    fail(`${brokenModels.length} model(s) failed to initialize correctly.`);
  }

  // ---- 3. Associations ----------------------------------------------------
  let associationCount = 0;
  const brokenAssociations = [];

  for (const name of modelNames) {
    const model = db[name];
    const associations = model.associations || {};

    for (const [alias, association] of Object.entries(associations)) {
      associationCount += 1;

      // A wired-up association must resolve to a model that is itself loaded.
      const target = association.target;
      if (!target || !modelNames.includes(target.name)) {
        brokenAssociations.push(
          `${name}.${alias} -> unresolved target ${target ? target.name : "(none)"}`
        );
      }
    }

    // Any model declaring associate() should have produced at least one.
    if (typeof model.associate === "function" && Object.keys(associations).length === 0) {
      brokenAssociations.push(`${name} declares associate() but registered no associations`);
    }
  }

  if (brokenAssociations.length > 0) {
    for (const problem of brokenAssociations) {
      console.error(`  ${FAIL} ${problem}`);
    }
    fail(`${brokenAssociations.length} association(s) failed to initialize.`);
  }

  console.log(`${OK} Associations loaded successfully`);
  console.log("");

  // ---- 4. Totals ----------------------------------------------------------
  console.log(`Models:       ${modelNames.length}`);
  console.log(`Associations: ${associationCount}`);

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  fail("verify-schema failed unexpectedly", err);
});
