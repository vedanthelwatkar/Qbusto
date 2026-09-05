#!/usr/bin/env node
/**
 * verify-schema
 *
 * Quick sanity check to run straight after `make migrate`.
 *
 * Confirms two independent things, and both are required to pass:
 *
 *   1. The Sequelize layer is healthy: every model file loaded, each model is
 *      properly initialized against the sequelize instance, and every
 *      association was wired up by models/index.js.
 *   2. The database a model claims to read actually has the table and columns
 *      it declares, queried straight from `sys.tables` / `sys.columns` -
 *      never inferred from the model definition itself.
 *
 * (2) exists because (1) alone is not a database check at all: a model
 * initializes correctly whether or not its table exists, so a database
 * missing `session`/`screen_layout` used to print a clean ✓ for all
 * both. That happened for real - see docs/client-database-changes.md and
 * the 20260824000100 migration that fixes the missing tables. This script
 * would have caught it on day one if it had ever queried the database.
 *
 * Nullability and (loosely) type are compared where practical, but a mismatch
 * there is reported as a warning, not a failure: SQL Server's native types
 * don't map onto Sequelize's one-to-one (STRING covers varchar, nvarchar and
 * char alike), so an exact match isn't a meaningful bar. A missing table or a
 * missing column is unambiguous and is always a failure.
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

  // ---- 4. Actual database structure ----------------------------------------
  //
  // Everything above can pass against a database with none of these tables in
  // it. This is the step that actually looks.
  const dbColumns = new Map(); // "tablename" (lowercased) -> Set of lowercased column names, or null if the table is missing
  const [allColumns] = await sequelize.query(
    "SELECT t.name AS table_name, c.name AS column_name, ty.name AS data_type, " +
      "c.is_nullable AS is_nullable " +
      "FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id " +
      "JOIN sys.types ty ON ty.user_type_id = c.user_type_id"
  );
  const dbTableNames = new Set();
  for (const row of allColumns) {
    const table = row.table_name.toLowerCase();
    dbTableNames.add(table);
    if (!dbColumns.has(table)) dbColumns.set(table, new Map());
    dbColumns
      .get(table)
      .set(row.column_name.toLowerCase(), { type: row.data_type, nullable: row.is_nullable });
  }

  /** Sequelize DataType constructor name -> data types it can plausibly map to. */
  const TYPE_FAMILIES = {
    STRING: ["varchar", "nvarchar", "char", "nchar", "text", "ntext"],
    TEXT: ["varchar", "nvarchar", "text", "ntext"],
    INTEGER: ["int", "smallint", "tinyint", "bigint"],
    SMALLINT: ["smallint", "tinyint"],
    BIGINT: ["bigint"],
    BOOLEAN: ["bit"],
    DATE: ["datetime", "datetime2", "date", "smalldatetime"],
    DATEONLY: ["date"],
    DECIMAL: ["decimal", "numeric", "money", "smallmoney"],
    FLOAT: ["float", "real"],
  };

  const missingTables = [];
  const missingColumns = [];
  const warnings = [];

  console.log("Database structure:");
  for (const name of modelNames) {
    const model = db[name];
    const tableName = model.getTableName().toLowerCase();

    if (!dbTableNames.has(tableName)) {
      missingTables.push(`${name} -> table [${tableName}] does not exist`);
      console.log(`  ${FAIL} ${tableName} - table does not exist`);
      continue;
    }

    const columns = dbColumns.get(tableName);
    let tableOk = true;

    for (const [attrName, attribute] of Object.entries(model.rawAttributes)) {
      // VIRTUAL attributes are computed in JS and never backed by a column by
      // design (e.g. User.password, hashed into password_hash by a hook) -
      // requiring one here would be checking for a column that was never
      // supposed to exist.
      const family = attribute.type && attribute.type.constructor && attribute.type.constructor.name;
      if (family === "VIRTUAL") continue;

      const columnName = (attribute.field || attrName).toLowerCase();
      const actual = columns.get(columnName);

      if (!actual) {
        missingColumns.push(`${name}.${attrName} -> column [${tableName}].[${columnName}] does not exist`);
        tableOk = false;
        continue;
      }

      const acceptable = TYPE_FAMILIES[family];
      if (acceptable && !acceptable.includes(actual.type)) {
        warnings.push(
          `${name}.${attrName}: expected a type compatible with ${family} (${acceptable.join("/")}), ` +
            `found ${actual.type} on [${tableName}].[${columnName}]`
        );
      }

      // allowNull:false on the model but nullable in the database is the
      // direction that matters - the app may write a NULL the model believes
      // can never happen. The reverse (a nullable model attribute backed by a
      // NOT NULL column) causes no bug and is not flagged.
      if (attribute.allowNull === false && actual.nullable) {
        warnings.push(
          `${name}.${attrName}: model requires a value but [${tableName}].[${columnName}] allows NULL`
        );
      }
    }

    if (tableOk) {
      console.log(`  ${OK} ${tableName} (${Object.keys(model.rawAttributes).length} column(s))`);
    } else {
      console.log(`  ${FAIL} ${tableName} - missing column(s), see below`);
    }
  }
  console.log("");

  if (warnings.length > 0) {
    console.log("Warnings (type/nullability mismatches - not fatal):");
    for (const warning of warnings) console.log(`  ! ${warning}`);
    console.log("");
  }

  if (missingTables.length > 0 || missingColumns.length > 0) {
    for (const problem of missingTables) console.error(`  ${FAIL} ${problem}`);
    for (const problem of missingColumns) console.error(`  ${FAIL} ${problem}`);
    fail(
      `${missingTables.length} table(s) and ${missingColumns.length} column(s) required by the ` +
        `models are missing from the database. Run migrations before deploying.`
    );
  }

  console.log(`${OK} Every model's table and columns exist in the database`);
  console.log("");

  // ---- 5. Totals ----------------------------------------------------------
  console.log(`Models:       ${modelNames.length}`);
  console.log(`Associations: ${associationCount}`);

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  fail("verify-schema failed unexpectedly", err);
});
