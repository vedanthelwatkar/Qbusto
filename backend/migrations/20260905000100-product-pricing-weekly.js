'use strict';

/**
 * product_pricing: one row per (cinema, product), seven day prices.
 *
 * WHAT THIS REPLACES
 *
 * Pricing was one row per (cinema, product, day_of_week), with `day_of_week`
 * 0 meaning "every day" and a specific day overriding it. Setting a weekend
 * price therefore meant creating a second row through a second pass of the
 * Dashboard's "add price" form, and reading a product's week meant assembling
 * up to eight rows in your head. The rows become columns:
 *
 *     monday_price ... sunday_price   DECIMAL(10,2) NULL
 *
 * NULL is meaningful: it is "no price on that day", which is exactly what a
 * missing row meant before, and it keeps a product unsellable on days its
 * operator never priced.
 *
 * THE DISCOUNT DIMENSION IS DELIBERATELY REDUCED
 *
 * The discount columns stay, but they now belong to the (cinema, product) row
 * rather than to one day of it. That is a real reduction in expressiveness and
 * it was checked against the live data before being chosen: of 160 rows in 154
 * (cinema, product) groups, exactly ONE group had a day-specific discount -
 * cinema 1 / product 14, a demo row - and cinema 8, the live cinema, has no
 * discounts at all. See the conversion note on that group below.
 *
 * NOT RE-RUNNABLE IN SPIRIT, THOUGH IT IS GUARDED
 *
 * Every step checks for its own effect first, so re-running is safe. But the
 * collapse deletes the superseded per-day rows, and `down()` cannot bring them
 * back - seven columns cannot be split into rows without knowing which of them
 * were once "every day" and which were overrides. `down()` therefore refuses,
 * in line with every other data-carrying migration in this repository.
 */

const DAY_COLUMNS = [
  [1, 'monday_price'],
  [2, 'tuesday_price'],
  [3, 'wednesday_price'],
  [4, 'thursday_price'],
  [5, 'friday_price'],
  [6, 'saturday_price'],
  [7, 'sunday_price'],
];

/** Does a column exist on product_pricing? */
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
    // 1. The seven columns. Nullable, because "no price this day" is a state
    //    the live data already contains (cinema 8 / product 151 is priced on
    //    Friday, Saturday and Sunday only).
    // -----------------------------------------------------------------------
    for (const [, column] of DAY_COLUMNS) {
      if (!(await hasColumn(queryInterface, column))) {
        await sequelize.query(
          `ALTER TABLE [dbo].[product_pricing] ADD [${column}] DECIMAL(10, 2) NULL`
        );
      }
    }

    /*
     * Nothing left to convert once `day_of_week` is gone.
     *
     * This has to come BEFORE the pre-flight check below, which reads that
     * column: on a second run it no longer exists, and a re-run must be a
     * no-op rather than an error.
     */
    if (!(await hasColumn(queryInterface, 'day_of_week'))) return;

    /*
     * 0. REFUSE RATHER THAN LOSE A DISCOUNT THIS CANNOT REPRESENT.
     *
     * Discounts stop being per-day, so a day-specific row whose discount
     * differs from its everyday sibling has to go somewhere. Step 2b folds the
     * FLAT case into that day's price, which is exact. Every other case - a
     * percentage, or channel overrides with no flat value to fold - would
     * change what somebody pays, so it stops here with the rows named instead
     * of guessing.
     *
     * On the live database this finds nothing: the single day-specific
     * discount is flat, and cinema 8 has no discounts at all.
     */
    const [unfoldable] = await sequelize.query(`
      SELECT day.[id], day.[cinema_id], day.[product_id], day.[day_of_week],
             day.[discount_type], day.[discount_value]
      FROM [dbo].[product_pricing] AS day
      WHERE day.[day_of_week] <> 0
        AND day.[discount_type] IS NOT NULL
        AND NOT (day.[discount_type] = 'F' AND day.[discount_value] IS NOT NULL)
    `);

    if (unfoldable.length > 0) {
      const detail = unfoldable
        .map(
          (row) =>
            `id=${row.id} cinema=${row.cinema_id} product=${row.product_id} day=${row.day_of_week} ${row.discount_type}/${row.discount_value}`
        )
        .join('; ');

      throw new Error(
        'Refusing to migrate: these day-specific pricing rows carry a discount that cannot be folded ' +
          `into a single day price without changing what a customer pays. Resolve them first: ${detail}`
      );
    }

    // -----------------------------------------------------------------------
    // 2. Fill the seven columns.
    //
    //    Precedence is exactly what `selectPricing` applied at read time: a
    //    row for that specific day wins, otherwise the day_of_week = 0 row,
    //    otherwise nothing. Written as two passes in that order so the second
    //    can only fill what the first left NULL.
    // -----------------------------------------------------------------------
    for (const [day, column] of DAY_COLUMNS) {
      // Pass A - the day's own row, where one exists.
      await sequelize.query(`
        UPDATE target
        SET target.[${column}] = source.[base_price]
        FROM [dbo].[product_pricing] AS target
        INNER JOIN [dbo].[product_pricing] AS source
          ON source.[cinema_id] = target.[cinema_id]
         AND source.[product_id] = target.[product_id]
         AND source.[day_of_week] = ${day}
      `);

      // Pass B - the everyday row, only where the day has no row of its own.
      await sequelize.query(`
        UPDATE target
        SET target.[${column}] = source.[base_price]
        FROM [dbo].[product_pricing] AS target
        INNER JOIN [dbo].[product_pricing] AS source
          ON source.[cinema_id] = target.[cinema_id]
         AND source.[product_id] = target.[product_id]
         AND source.[day_of_week] = 0
        WHERE target.[${column}] IS NULL
      `);
    }

    /*
     * 2b. The one group whose discount cannot survive the reduction.
     *
     * cinema 1 / product 14 carried a Wednesday-only flat discount: base 620,
     * discountValue 75, discountOnKiosk 100. With discounts no longer being
     * per-day, the Wednesday PRICE absorbs it instead - 620 - 75 = 545, which
     * is what QR, seat-QR and counter customers pay today and therefore leaves
     * every reachable channel unchanged. Kiosk alone would have paid 520; it
     * has never been used (no kiosk client exists, no order has ever carried
     * that source), which is why absorbing into the price was chosen over
     * spreading the discount across all seven days.
     *
     * Written as a rule rather than as "UPDATE row 12" so it is inspectable
     * and so a database in a different state is not silently skipped: any
     * day-specific row carrying a FLAT discount its everyday sibling does not
     * have has that discount folded into its own day's price. A PERCENTAGE
     * discount is not folded - it is left to the report below, because
     * flattening a percentage silently changes the arithmetic if the price is
     * later edited.
     */
    for (const [day, column] of DAY_COLUMNS) {
      await sequelize.query(`
        UPDATE target
        SET target.[${column}] =
          CASE WHEN source.[base_price] - source.[discount_value] < 0 THEN 0
               ELSE source.[base_price] - source.[discount_value] END
        FROM [dbo].[product_pricing] AS target
        INNER JOIN [dbo].[product_pricing] AS source
          ON source.[cinema_id] = target.[cinema_id]
         AND source.[product_id] = target.[product_id]
         AND source.[day_of_week] = ${day}
        WHERE source.[discount_type] = 'F'
          AND source.[discount_value] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM [dbo].[product_pricing] AS everyday
            WHERE everyday.[cinema_id] = target.[cinema_id]
              AND everyday.[product_id] = target.[product_id]
              AND everyday.[day_of_week] = 0
              AND everyday.[discount_type] IS NULL
          )
      `);
    }

    // -----------------------------------------------------------------------
    // 3. Collapse to one row per (cinema, product).
    //
    //    The survivor is the everyday row where there is one, because that is
    //    the row whose discounts and is_active describe the group as a whole;
    //    otherwise the lowest day number, which is the only other row that can
    //    carry them. Every row already holds all seven prices after step 2, so
    //    which survivor is chosen does not affect the prices.
    // -----------------------------------------------------------------------
    await sequelize.query(`
      WITH ranked AS (
        SELECT [id],
               ROW_NUMBER() OVER (
                 PARTITION BY [cinema_id], [product_id]
                 ORDER BY CASE WHEN [day_of_week] = 0 THEN 0 ELSE 1 END, [day_of_week], [id]
               ) AS rn
        FROM [dbo].[product_pricing]
      )
      DELETE FROM [dbo].[product_pricing]
      WHERE [id] IN (SELECT [id] FROM ranked WHERE rn > 1)
    `);

    // -----------------------------------------------------------------------
    // 4. The unique key loses its day component.
    // -----------------------------------------------------------------------
    await sequelize.query(`
      IF EXISTS (SELECT 1 FROM sys.indexes
                 WHERE name = 'UQ_product_pricing'
                   AND object_id = OBJECT_ID('dbo.product_pricing'))
        DROP INDEX [UQ_product_pricing] ON [dbo].[product_pricing];
    `);

    await sequelize.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes
                     WHERE name = 'UQ_product_pricing_cinema_product'
                       AND object_id = OBJECT_ID('dbo.product_pricing'))
        CREATE UNIQUE INDEX [UQ_product_pricing_cinema_product]
          ON [dbo].[product_pricing] ([cinema_id], [product_id]);
    `);

    // -----------------------------------------------------------------------
    // 5. Drop the old columns, and the constraints that depend on them.
    //    SQL Server will not drop a column while a default or check names it,
    //    and those constraints were auto-named, so they are looked up.
    // -----------------------------------------------------------------------
    await sequelize.query(`
      DECLARE @sql NVARCHAR(MAX) = N'';

      SELECT @sql = @sql + N'ALTER TABLE [dbo].[product_pricing] DROP CONSTRAINT [' + dc.name + N'];'
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.product_pricing')
        AND c.name IN ('day_of_week', 'base_price');

      SELECT @sql = @sql + N'ALTER TABLE [dbo].[product_pricing] DROP CONSTRAINT [' + cc.name + N'];'
      FROM sys.check_constraints cc
      INNER JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
      WHERE cc.parent_object_id = OBJECT_ID('dbo.product_pricing')
        AND c.name IN ('day_of_week', 'base_price');

      IF @sql <> N'' EXEC sp_executesql @sql;
    `);

    for (const column of ['day_of_week', 'base_price']) {
      if (await hasColumn(queryInterface, column)) {
        await sequelize.query(`ALTER TABLE [dbo].[product_pricing] DROP COLUMN [${column}]`);
      }
    }

    // -----------------------------------------------------------------------
    // 6. A price is never negative. The old CK_product_pricing_base_price said
    //    so for the one column; seven columns need seven, and each allows NULL
    //    because NULL means "not sold that day".
    // -----------------------------------------------------------------------
    for (const [, column] of DAY_COLUMNS) {
      await sequelize.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                       WHERE name = 'CK_product_pricing_${column}'
                         AND parent_object_id = OBJECT_ID('dbo.product_pricing'))
          ALTER TABLE [dbo].[product_pricing]
            ADD CONSTRAINT [CK_product_pricing_${column}] CHECK ([${column}] IS NULL OR [${column}] >= 0);
      `);
    }
  },

  async down() {
    /*
     * Refused, not implemented.
     *
     * up() deletes the superseded per-day rows and folds one flat discount
     * into a price. Splitting seven columns back into rows would have to guess
     * which values were once an "every day" row and which were overrides, and
     * the folded discount cannot be recovered from the number that absorbed
     * it. Restore from a backup instead - which is the honest instruction, and
     * the same one every other data-carrying migration here gives.
     */
    throw new Error(
      'Irreversible: 20260905000100-product-pricing-weekly collapsed per-day pricing rows into columns. Restore from a backup.'
    );
  },
};
