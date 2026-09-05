'use strict';

/**
 * Per-cinema category display order.
 *
 * The requirement: Cinema A leads with Desserts, Cinema B in the same chain
 * leads with Appetizers. `categories` is chain-scoped so it cannot hold that;
 * the answer lives on the `cinema_categories` link row, which already carried
 * a `sequence` column and needed no schema change.
 *
 * The subtle part, and what most of this file pins, is the meaning of
 * sequence 0. It is the column's default, so every pre-existing row has it,
 * and reading it as "first" would shuffle every cinema that has never set an
 * order. It means UNPLACED and sorts last.
 */

jest.mock('../src/config/database', () => ({
  models: {
    Cinema: { findOne: jest.fn() },
    Category: { findAll: jest.fn(), count: jest.fn() },
    CinemaCategory: { findAll: jest.fn(), update: jest.fn(), findOrCreate: jest.fn() },
  },
  sequelize: { transaction: jest.fn((cb) => cb('TX')) },
}));

jest.mock('../src/services/cache.service', () => ({
  invalidatingAfter: (fn) => fn,
  wrap: (_namespace, _cinemaId, _key, produce) => produce(),
}));

const { models, sequelize } = require('../src/config/database');
const categoryService = require('../src/services/category.service');
const { NotFoundError, ValidationError } = require('../src/utils/errors');

const CINEMA_ID = 8;
const CHAIN_ID = 1;

const OWNER = { id: 1, role: 'owner', chainId: null };
const CHAIN_ADMIN = { id: 2, role: 'chain_admin', chainId: CHAIN_ID };

/** The chain's categories, as `Category.findAll` returns them. */
const CATEGORIES = [
  { id: 10, name: 'Appetizers' },
  { id: 11, name: 'Desserts' },
  { id: 12, name: 'Main Course' },
];

function arrange({ links = [], cinema = { id: CINEMA_ID, chainId: CHAIN_ID } } = {}) {
  models.Cinema.findOne.mockResolvedValue(cinema);
  models.Category.findAll.mockResolvedValue(CATEGORIES);
  models.CinemaCategory.findAll.mockResolvedValue(links);
  models.Category.count.mockImplementation(async ({ where }) => {
    const wanted = where.id[Object.getOwnPropertySymbols(where.id)[0]] ?? [];
    return wanted.filter((id) => CATEGORIES.some((category) => category.id === id)).length;
  });
  models.CinemaCategory.update.mockResolvedValue([0]);
  models.CinemaCategory.findOrCreate.mockImplementation(async () => [
    { update: jest.fn().mockResolvedValue() },
    true,
  ]);
  sequelize.transaction.mockImplementation((cb) => cb('TX'));
}

const names = (entries) => entries.map((entry) => entry.name);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reading the order', () => {
  it('falls back to alphabetical when no category has been placed', async () => {
    arrange({ links: [] });

    const order = await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(names(order)).toEqual(['Appetizers', 'Desserts', 'Main Course']);
    expect(order.every((entry) => entry.sequence === 0)).toBe(true);
  });

  it('puts placed categories first, in sequence', async () => {
    // The client's own example: Desserts, Appetizers, Main Course.
    arrange({
      links: [
        { categoryId: 11, sequence: 1 },
        { categoryId: 10, sequence: 2 },
        { categoryId: 12, sequence: 3 },
      ],
    });

    const order = await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(names(order)).toEqual(['Desserts', 'Appetizers', 'Main Course']);
  });

  it('sorts an unplaced category AFTER every placed one, not before', async () => {
    // Sequence 0 is the column default, so this is the case that decides
    // whether switching the feature on reshuffles a cinema nobody has ordered.
    arrange({
      links: [
        { categoryId: 12, sequence: 1 },
        { categoryId: 10, sequence: 0 },
      ],
    });

    const order = await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(names(order)).toEqual(['Main Course', 'Appetizers', 'Desserts']);
  });

  it('is a total order: equal sequences break by name rather than arbitrarily', async () => {
    arrange({
      links: [
        { categoryId: 12, sequence: 1 },
        { categoryId: 10, sequence: 1 },
      ],
    });

    const order = await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(names(order).slice(0, 2)).toEqual(['Appetizers', 'Main Course']);
  });

  it('lists every category in the chain, including ones with no link row', async () => {
    // An admin ordering a list has to see the whole list.
    arrange({ links: [{ categoryId: 11, sequence: 1 }] });

    const order = await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(order).toHaveLength(3);
  });

  it('reads the chain from the cinema, so two cinemas can differ', async () => {
    arrange({ links: [{ categoryId: 11, sequence: 1 }] });

    await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(models.CinemaCategory.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cinemaId: CINEMA_ID, isActive: true } })
    );
  });
});

describe('tenant scope', () => {
  it('404s rather than 403s for a cinema outside the actor chain', async () => {
    arrange({ cinema: null });

    await expect(categoryService.listCategoryOrder(CHAIN_ADMIN, CINEMA_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('scopes a non-owner to their own chain', async () => {
    arrange();

    await categoryService.listCategoryOrder(CHAIN_ADMIN, CINEMA_ID);

    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CINEMA_ID, chainId: CHAIN_ID } })
    );
  });

  it('does not narrow an owner', async () => {
    arrange();

    await categoryService.listCategoryOrder(OWNER, CINEMA_ID);

    expect(models.Cinema.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CINEMA_ID } })
    );
  });
});

describe('writing the order', () => {
  it('assigns sequence 1..n from the array positions', async () => {
    arrange();
    const updates = [];
    models.CinemaCategory.findOrCreate.mockImplementation(async ({ defaults }) => {
      updates.push({ categoryId: defaults.categoryId, sequence: defaults.sequence });
      return [{ update: jest.fn() }, true];
    });

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11, 10, 12]);

    expect(updates).toEqual([
      { categoryId: 11, sequence: 1 },
      { categoryId: 10, sequence: 2 },
      { categoryId: 12, sequence: 3 },
    ]);
  });

  it('resets every link to unplaced first, so a dropped category loses its slot', async () => {
    arrange();

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11]);

    expect(models.CinemaCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 0 }),
      expect.objectContaining({ where: { cinemaId: CINEMA_ID } })
    );
  });

  it('updates a link that already exists rather than leaving it stale', async () => {
    arrange();
    const update = jest.fn().mockResolvedValue();
    models.CinemaCategory.findOrCreate.mockResolvedValue([{ update }, false]);

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11, 10]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequence: 2 }),
      expect.anything()
    );
  });

  it('reactivates a deactivated link instead of writing an order nobody reads', async () => {
    arrange();
    const update = jest.fn().mockResolvedValue();
    // The link exists but is inactive. findOrCreate matches on
    // (cinemaId, categoryId) alone, so it is found either way.
    models.CinemaCategory.findOrCreate.mockResolvedValue([{ update, isActive: false }, false]);

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11]);

    /*
     * Both readers filter is_active = 1. Without this, the sequence would be
     * written, the endpoint would answer 200, and the order would have no
     * effect anywhere - the worst kind of failure, because it looks like it
     * worked.
     */
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 1, isActive: true }),
      expect.anything()
    );
  });

  it('rejects a duplicated category rather than silently keeping the last position', async () => {
    arrange();

    await expect(
      categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11, 10, 11])
    ).rejects.toBeInstanceOf(ValidationError);

    expect(models.CinemaCategory.findOrCreate).not.toHaveBeenCalled();
  });

  it('404s for a category outside the cinema chain, before writing anything', async () => {
    arrange();

    await expect(
      categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11, 9999])
    ).rejects.toBeInstanceOf(NotFoundError);

    // Checked up front, so no partial order is left behind.
    expect(models.CinemaCategory.update).not.toHaveBeenCalled();
    expect(models.CinemaCategory.findOrCreate).not.toHaveBeenCalled();
  });

  it('accepts an empty list, clearing the order back to alphabetical', async () => {
    arrange();

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, []);

    expect(models.CinemaCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 0 }),
      expect.anything()
    );
    expect(models.CinemaCategory.findOrCreate).not.toHaveBeenCalled();
  });

  it('writes the whole order in one transaction', async () => {
    arrange();

    await categoryService.setCategoryOrder(OWNER, CINEMA_ID, [11, 10, 12]);

    // A reset that committed without the reassignment would leave every
    // category unplaced.
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });
});
