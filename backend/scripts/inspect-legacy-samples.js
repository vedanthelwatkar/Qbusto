require("dotenv").config();
const sql = require("mssql");
const fs = require("fs");
const path = require("path");

const config = {
  server: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "Vista_PopExpress",
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
};

const SAMPLE_QUERIES = {
  cinema_ids: `SELECT TOP 20 Cinema_strID, Cinema_strName FROM tblCinema`,

  category_samples: `SELECT TOP 20 ItemCategoryID, Cinema_strID, ItemCategoryShortDescription, Sequence, IsActive FROM DAE_ItemCategory`,

  category_cinema_wise: `SELECT TOP 20 * FROM DAE_ItemCategoryCinemaWise`,

  item_samples: `SELECT TOP 10 ItemID, ItemCategoryID, ItemName, ItemWeight, IsActive, IsItemComplementary, IsAddon, IsAddonItemParentID, TaxSlabID, QRDiscount, KioskDiscount, SeatQRDiscount, BillMeDiscount FROM DAE_Items`,

  item_pricing_sample: `SELECT TOP 10 ItemCinemaPrice, ItemID, Cinema_strID, Item_strMasterItemcode, ItemComplementPrice_Monday, ItemComplementDiscountType_Monday, QRDiscount, KioskDiscount, SeatQRDiscount, BillMeDiscount FROM DAE_ItemCinemaPrice`,

  order_sources: `SELECT DISTINCT OrderSource FROM DAE_Orders`,
  order_modes: `SELECT DISTINCT Mode FROM DAE_Orders`,
  order_sources_field: `SELECT DISTINCT Source FROM DAE_Orders`,
  order_statuses: `SELECT * FROM DAE_OrderStatus`,
  order_delivery_statuses: `SELECT DISTINCT OrderDeliveryStatus FROM DAE_Orders`,

  order_samples: `SELECT TOP 5 OrderID, Cinema_strID, OrderStatusID, OrderSource, OrderDate, OrderDiscount, OrderPrice, OrderFinalPrice, OrderPaymentReferenceNumber, OrderPaymentSourceID, OrderCustomerScreenNumber, OrderCustomerSeatNumber, Mode, Source, OrderDeliveryStatus FROM DAE_Orders ORDER BY OrderID DESC`,

  banner_types: `SELECT DISTINCT BannerType FROM DAE_Banners`,

  user_roles: `SELECT * FROM DAE_UserRoles`,

  user_samples: `SELECT TOP 10 UserID, Cinema_strID, UserTypeID, UserRoleID, Username, FirstName, LastName FROM DAE_Users`,

  discount_types_items: `SELECT DISTINCT ItemDiscountType_Monday FROM DAE_Items WHERE ItemDiscountType_Monday IS NOT NULL`,

  item_prices_sample: `SELECT TOP 5 ItemID, ItemName, ItemPrice_Monday, ItemDiscountType_Monday, ItemDiscount_Monday, ItemSellingPrice_Monday FROM DAE_Items WHERE ItemPrice_Monday IS NOT NULL`,
};

const INDEX_QUERY = `
  SELECT
    t.name AS table_name,
    i.name AS index_name,
    i.is_unique,
    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  JOIN sys.tables t ON t.object_id = i.object_id
  WHERE t.name IN (
    'DAE_Banners','DAE_ItemCategory','DAE_ItemCategoryCinemaWise',
    'DAE_ItemCinemaPrice','DAE_Items','DAE_OrderItems','DAE_Orders',
    'DAE_OrderStatus','DAE_SystemConfig','DAE_UserRoleForms',
    'DAE_UserRoles','DAE_Users','tblCinema','tblLicenses'
  )
  AND i.name IS NOT NULL
  AND i.type > 0
  GROUP BY t.name, i.name, i.is_unique
  ORDER BY t.name, i.name;
`;

async function main() {
  const pool = await sql.connect(config);
  const output = {};

  for (const [key, query] of Object.entries(SAMPLE_QUERIES)) {
    console.log(`Running: ${key}`);
    try {
      const result = await pool.request().query(query);
      output[key] = result.recordset;
    } catch (err) {
      output[key] = { error: err.message };
    }
  }

  console.log("Running: indexes");
  try {
    const result = await pool.request().query(INDEX_QUERY);
    output.indexes = result.recordset;
  } catch (err) {
    output.indexes = { error: err.message };
  }

  const outPath = path.join(__dirname, "legacy-samples-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nDone. Written to ${outPath}`);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
