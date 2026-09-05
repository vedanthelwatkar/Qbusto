'use strict';

/**
 * product_pricing: a discount per DAY, not one shared by the whole week.
 *
 * WHY
 *
 * 20260905000100 collapsed one-row-per-day pricing into seven price columns,
 * but kept ONE shared discount (`discount_type`/`discount_value`/
 * `discount_on_*`) for the whole row. Checked against the live data before
 * this migration was written, in `db_export/product_pricing_pre_weekly_20260905.json`:
 *
 *   - 4 rows carried a discount on their `day_of_week = 0` ("every day") row -
 *     those discounts already applied uniformly to the whole week, so a single
 *     shared discount represented them exactly.
 *   - 1 row (cinema 1 / product 14) carried a discount on `day_of_week = 3`
 *     (Wednesday) ONLY, with no discount on its sibling "every day" row. That
 *     is a genuinely day-specific discount, and 20260905000100 folded it into
 *     `wednesday_price` (620 - 75 = 545) rather than lose it, exactly as its
 *     own header records.
 *
 * That folding was correct for the ONE row it applied to, but it does not
 * generalise: a shared discount cannot represent "10% off, but only on
 * Fridays" without leaking onto Thursday. So the schema needs a discount PER
 * DAY, matching the seven price columns exactly - `{day}_discount_type`,
 * `{day}_discount_value`, `{day}_discount_on_{channel}`, seven times.
 *
 * MIGRATING THE 4 "EVERY DAY" ROWS
 *
 * Each of the 4 rows above becomes seven IDENTICAL day-discounts - the same
 * type/value/channel amounts, copied onto all seven days - because that is
 * what "discount applies every day" already meant. No value is invented; every
 * value comes from the row's own (now-removed) shared discount columns.
 *
 * The Wednesday-only row (cinema 1 / product 14) needs nothing here: it has no
 * shared discount left to migrate, and its price already reflects it.
 *
 * NOT RE-RUNNABLE IN SPIRIT, THOUGH GUARDED
 *
 * Every step checks for its own effect first. The population step keys off
 * "does the OLD shared column still exist", so it can only run once; after the
 * old columns are dropped, re-running is a no-op that adds nothing and drops
 * nothing further.
 */

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const CHANNELS = ['qr', 'kiosk', 'seat_qr', 'counter'];

async function hasColumn(queryInterface, column) {
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS n FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.product_pricing') AND name = '${column}'`
  );

  return Number(row.n) > 0;
}

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    // -----------------------------------------------------------------------
    // 1. Seven sets of discount columns - type, value, and four channels.
    // -----------------------------------------------------------------------
    for (const day of DAYS) {
      const typeCol = `${day}_discount_type`;
      if (!(await hasColumn(queryInterface, typeCol))) {
        await sequelize.query(
          `ALTER TABLE [dbo].[product_pricing] ADD [${typeCol}] CHAR(1) NULL`
        );
      }

      const valueCol = `${day}_discount_value`;
      if (!(await hasColumn(queryInterface, valueCol))) {
        await sequelize.query(
          `ALTER TABLE [dbo].[product_pricing] ADD [${valueCol}] DECIMAL(10, 2) NULL`
        );
      }

      for (const channel of CHANNELS) {
        const channelCol = `${day}_discount_on_${channel}`;
        if (!(await hasColumn(queryInterface, channelCol))) {
          await sequelize.query(
            `ALTER TABLE [dbo].[product_pricing] ADD [${channelCol}] DECIMAL(10, 2) NULL`
          );
        }
      }
    }

    // Nothing to migrate or drop if the old shared columns are already gone -
    // this is what makes a second run a no-op.
    if (!(await hasColumn(queryInterface, 'discount_type'))) return;

    // -----------------------------------------------------------------------
    // 2. Copy the shared discount onto all seven days, for rows that have one.
    //    Every value comes from the row's own columns - nothing invented.
    // -----------------------------------------------------------------------
    for (const day of DAYS) {
      await sequelize.query(`
        UPDATE [dbo].[product_pricing]
        SET [${day}_discount_type] = [discount_type],
            [${day}_discount_value] = [discount_value],
            [${day}_discount_on_qr] = [discount_on_qr],
            [${day}_discount_on_kiosk] = [discount_on_kiosk],
            [${day}_discount_on_seat_qr] = [discount_on_seat_qr],
            [${day}_discount_on_counter] = [discount_on_counter]
        WHERE [discount_type] IS NOT NULL
      `);
    }

    // -----------------------------------------------------------------------
    // 3. Drop the old shared columns and the constraints that name them.
    // -----------------------------------------------------------------------
    await sequelize.query(`
      DECLARE @sql NVARCHAR(MAX) = N'';

      SELECT @sql = @sql + N'ALTER TABLE [dbo].[product_pricing] DROP CONSTRAINT [' + dc.name + N'];'
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.product_pricing')
        AND c.name IN ('discount_type', 'discount_value', 'discount_on_qr', 'discount_on_kiosk', 'discount_on_seat_qr', 'discount_on_counter');

      SELECT @sql = @sql + N'ALTER TABLE [dbo].[product_pricing] DROP CONSTRAINT [' + cc.name + N'];'
      FROM sys.check_constraints cc
      INNER JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
      WHERE cc.parent_object_id = OBJECT_ID('dbo.product_pricing')
        AND c.name IN ('discount_type', 'discount_value', 'discount_on_qr', 'discount_on_kiosk', 'discount_on_seat_qr', 'discount_on_counter');

      IF @sql <> N'' EXEC sp_executesql @sql;
    `);

    for (const column of [
      'discount_type',
      'discount_value',
      'discount_on_qr',
      'discount_on_kiosk',
      'discount_on_seat_qr',
      'discount_on_counter',
    ]) {
      if (await hasColumn(queryInterface, column)) {
        await sequelize.query(`ALTER TABLE [dbo].[product_pricing] DROP COLUMN [${column}]`);
      }
    }

    // -----------------------------------------------------------------------
    // 4. A discount amount is never negative, per day and per channel.
    // -----------------------------------------------------------------------
    for (const day of DAYS) {
      const columns = [
        `${day}_discount_value`,
        `${day}_discount_on_qr`,
        `${day}_discount_on_kiosk`,
        `${day}_discount_on_seat_qr`,
        `${day}_discount_on_counter`,
      ];

      for (const column of columns) {
        await sequelize.query(`
          IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                         WHERE name = 'CK_product_pricing_${column}'
                           AND parent_object_id = OBJECT_ID('dbo.product_pricing'))
            ALTER TABLE [dbo].[product_pricing]
              ADD CONSTRAINT [CK_product_pricing_${column}] CHECK ([${column}] IS NULL OR [${column}] >= 0);
        `);
      }
    }
  },

  async down() {
    /*
     * Refused, not implemented.
     *
     * up() copies each row's shared discount onto seven day-specific columns
     * and then drops the shared columns. Reversing that would mean collapsing
     * seven possibly-DIFFERENT day discounts back into one, which is only
     * lossless for rows that still happen to be uniform - and by the time this
     * runs backwards, a Dashboard user may well have made two days genuinely
     * different, which is the entire point of this migration. Restore from a
     * backup instead.
     */
    throw new Error(
      'Irreversible: 20260906000200-product-pricing-day-discounts moved discounts onto per-day columns. Restore from a backup.'
    );
  },
};
