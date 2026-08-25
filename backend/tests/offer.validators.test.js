'use strict';

/**
 * offer.validators.js - discountType normalisation.
 *
 * Regression coverage for a bug found in code review: OfferFormModal.tsx
 * used to compare `discountType` for exact equality with 'percentage', so an
 * offer stored with any other casing (e.g. 'PERCENTAGE', possible before
 * this validator normalised the field - or via a direct API call bypassing
 * the Dashboard's own lower-case Select) had its `maxDiscAmount` silently
 * nulled out by the next unrelated edit. Fixed in two places: the form's
 * comparison is now case-insensitive, and this validator now normalises
 * `discountType` to lower case on every write, so new data never drifts out
 * of the casing every reader already assumes.
 *
 * Exercised directly against the Joi schema - no HTTP layer, no database -
 * since normalisation is a property of the schema itself.
 */

const offerValidators = require('../src/validators/offer.validators');

const JOI_OPTIONS = { abortEarly: false, stripUnknown: true, convert: true };

describe('offer.validators - discountType normalisation', () => {
  test('create: an upper-case discountType is stored lower case', () => {
    const { value, error } = offerValidators.create.body.validate(
      {
        cinemaId: 1,
        code: 'SAVE10',
        name: 'Save 10%',
        discountType: 'PERCENTAGE',
        discAmount: 10,
      },
      JOI_OPTIONS
    );

    expect(error).toBeUndefined();
    expect(value.discountType).toBe('percentage');
  });

  test('update: an upper-case discountType is stored lower case', () => {
    const { value, error } = offerValidators.update.body.validate(
      { discountType: 'PERCENTAGE' },
      JOI_OPTIONS
    );

    expect(error).toBeUndefined();
    expect(value.discountType).toBe('percentage');
  });

  test('update: an existing percentage offer edited with mixed-case discountType keeps its maxDiscAmount', () => {
    // The exact shape OfferFormModal.tsx now sends after the fix: an
    // unrelated field changed (name), discountType still whatever case the
    // record was loaded with, and the real maxDiscAmount value - not null,
    // because the form's own isPercentage check is case-insensitive too.
    const { value, error } = offerValidators.update.body.validate(
      {
        name: 'Renamed weekend offer',
        discountType: 'Percentage',
        maxDiscAmount: 150,
      },
      JOI_OPTIONS
    );

    expect(error).toBeUndefined();
    expect(value.discountType).toBe('percentage');
    expect(value.maxDiscAmount).toBe(150);
  });

  test('a flat discountType is left as flat, only the casing is normalised', () => {
    const { value, error } = offerValidators.update.body.validate(
      { discountType: 'FLAT' },
      JOI_OPTIONS
    );

    expect(error).toBeUndefined();
    expect(value.discountType).toBe('flat');
  });
});
