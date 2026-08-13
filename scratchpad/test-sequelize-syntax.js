'use strict';

/**
 * Test to verify Sequelize behavior with nested Op.or syntax
 * This tests whether the pattern in consumer.service.js line 320-322 is valid
 */

const { Sequelize, Op } = require('sequelize');

// Create an in-memory SQLite database for testing
const sequelize = new Sequelize('sqlite::memory:', { logging: false });

// Define a test model
const TestModel = sequelize.define('test', {
  cinemaId: { type: Sequelize.INTEGER },
  startDate: { type: Sequelize.DATE, allowNull: true },
  endDate: { type: Sequelize.DATE, allowNull: true },
  isActive: { type: Sequelize.BOOLEAN },
});

async function test() {
  await sequelize.sync();

  const today = new Date();

  // Test the problematic syntax from consumer.service.js
  console.log('\n=== Testing nested Op.or syntax (PROBLEMATIC) ===');
  try {
    const where = {
      cinemaId: 1,
      isActive: true,
      startDate: { [Op.or]: [{ [Op.is]: null }, { [Op.lte]: today }] },
      endDate: { [Op.or]: [{ [Op.is]: null }, { [Op.gte]: today }] },
    };

    console.log('\nWhere object:', JSON.stringify(where, null, 2));

    // Build the query without executing
    const query = TestModel.findAll({ where });
    const sql = query.toJSON();
    console.log('\nGenerated SQL:', sql.sql);
    console.log('SQL replacements:', sql.replacements);
  } catch (error) {
    console.log('ERROR with nested Op.or:', error.message);
  }

  // Test the CORRECT syntax using top-level Op.or with Op.and
  console.log('\n\n=== Testing correct syntax with Op.and wrapper ===');
  try {
    const where = {
      [Op.and]: [
        { cinemaId: 1 },
        { isActive: true },
        {
          [Op.or]: [
            { startDate: null },
            { startDate: { [Op.lte]: today } },
          ],
        },
        {
          [Op.or]: [
            { endDate: null },
            { endDate: { [Op.gte]: today } },
          ],
        },
      ],
    };

    console.log('\nWhere object:', JSON.stringify(where, null, 2));

    const query = TestModel.findAll({ where });
    const sql = query.toJSON();
    console.log('\nGenerated SQL:', sql.sql);
    console.log('SQL replacements:', sql.replacements);
  } catch (error) {
    console.log('ERROR with Op.and wrapper:', error.message);
  }

  // Test alternative: using sequelize.where()
  console.log('\n\n=== Testing sequelize.where() alternative ===');
  try {
    const where = {
      cinemaId: 1,
      isActive: true,
      [Op.or]: [
        sequelize.where(sequelize.col('startDate'), Op.is, null),
        sequelize.where(sequelize.col('startDate'), Op.lte, today),
        sequelize.where(sequelize.col('endDate'), Op.is, null),
        sequelize.where(sequelize.col('endDate'), Op.gte, today),
      ],
    };

    console.log('\nWhere object (complex, see SQL)...');

    const query = TestModel.findAll({ where });
    const sql = query.toJSON();
    console.log('\nGenerated SQL:', sql.sql);
    console.log('SQL replacements:', sql.replacements);
  } catch (error) {
    console.log('ERROR with sequelize.where():', error.message);
  }

  process.exit(0);
}

test().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
