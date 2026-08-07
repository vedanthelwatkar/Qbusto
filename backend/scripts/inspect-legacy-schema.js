require("dotenv").config();
const sql = require("mssql");
const fs = require("fs");
const path = require("path");

// Tables actually relevant to a food-ordering system.
// Skips XFER_*, SYN_*, HangFire - those are sync/ticketing/job-queue internals.
const RELEVANT_TABLES = [
  "DAE_Banners",
  "DAE_ItemCategory",
  "DAE_ItemCategoryCinemaWise",
  "DAE_ItemCinemaPrice",
  "DAE_Items",
  "DAE_OrderItems",
  "DAE_Orders",
  "DAE_OrderStatus",
  "DAE_SystemConfig",
  "DAE_UserRoleForms",
  "DAE_UserRoles",
  "DAE_Users",
  "MenuForms",
  "MenuHeader",
  "MenuSubHeader",
  "tblCinema",
  "tblLicenses",
];

const config = {
  server: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "Vista_PopExpress", // legacy DB - separate from your qbusto config
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
};

async function getColumns(pool, tableName) {
  const result = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tableName}'
    ORDER BY ORDINAL_POSITION;
  `);
  return result.recordset;
}

async function getPrimaryKey(pool, tableName) {
  const result = await pool.request().query(`
    SELECT KU.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS TC
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KU
      ON TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
    WHERE TC.CONSTRAINT_TYPE = 'PRIMARY KEY' AND TC.TABLE_NAME = '${tableName}';
  `);
  return result.recordset.map((r) => r.COLUMN_NAME);
}

async function getForeignKeys(pool, tableName) {
  const result = await pool.request().query(`
    SELECT 
      fk.name AS constraint_name,
      c1.name AS column_name,
      t2.name AS referenced_table,
      c2.name AS referenced_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.tables t1 ON t1.object_id = fk.parent_object_id
    JOIN sys.tables t2 ON t2.object_id = fk.referenced_object_id
    JOIN sys.columns c1 ON c1.object_id = fkc.parent_object_id AND c1.column_id = fkc.parent_column_id
    JOIN sys.columns c2 ON c2.object_id = fkc.referenced_object_id AND c2.column_id = fkc.referenced_column_id
    WHERE t1.name = '${tableName}';
  `);
  return result.recordset;
}

async function main() {
  const pool = await sql.connect(config);
  const schema = {};

  for (const table of RELEVANT_TABLES) {
    console.log(`Reading ${table}...`);
    try {
      const [columns, primaryKey, foreignKeys] = await Promise.all([
        getColumns(pool, table),
        getPrimaryKey(pool, table),
        getForeignKeys(pool, table),
      ]);
      schema[table] = { columns, primaryKey, foreignKeys };
    } catch (err) {
      schema[table] = { error: err.message };
    }
  }

  const outPath = path.join(__dirname, "legacy-schema-output.json");
  fs.writeFileSync(outPath, JSON.stringify(schema, null, 2));
  console.log(`\nDone. Written to ${outPath}`);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
