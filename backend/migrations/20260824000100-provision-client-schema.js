'use strict';

/**
 * Creates `film`, `session`, `screen_layout` and the two columns
 * `screens.category` / `screens.seat_row` when they are absent.
 *
 * WHY THIS EXISTS
 *
 * These objects reached the development database only because the client's
 * own `.bak` was restored into it (see docs/client-database-changes.md and
 * 20260823001000-align-client-naming.js, which renamed `Film`/`Session` to
 * lowercase after that restore). No migration ever created them, so a
 * database provisioned from this repository's migrations alone - a fresh
 * install, a CI database, a disaster-recovery rebuild - ends up 5 objects
 * short of what the models declare, and every Film/Session/Screen query
 * fails with "Invalid object name" or a missing-column error.
 *
 * This migration is that missing definition. It is NOT a schema change: it
 * reproduces, exactly, the shapes already sitting in the client's database -
 * same table names, same provider column names, same types, same
 * nullability, same keys. Nothing about the client's structure is altered,
 * normalised or renamed here.
 *
 * WHY EVERY STEP IS GUARDED
 *
 * On the client's own database every one of these objects already exists.
 * Each step below checks for that first and skips itself when the object is
 * already there, so running this migration against the client's database is
 * a verified no-op: 0 rows change, 0 objects change. Only a database that is
 * missing an object gets it created.
 *
 * SOURCES FOR THE DDL
 *
 * `film` and `session`: the client-supplied CREATE TABLE scripts
 * (Qbusto_Film.txt, Qbusto_Session.txt), reproduced verbatim including their
 * named constraints (PK_Film, PK_Session, DF_Film_Film_dtmStamp,
 * DF_Session_Session_dtmStamp, FK_Session_Film, FK_Session_cinemas).
 *
 * `screen_layout`: the structure observed in the client's database via
 * `sys.columns`/`sys.foreign_keys`. Its constraints there carry SQL Server's
 * auto-generated hash names (e.g. `FK__screen_la__cinem__0880433F`), which is
 * what an unnamed CREATE TABLE produces - so constraints here are left
 * unnamed too, matching how the client's own copy was built.
 *
 * `screens.category` / `screens.seat_row`: the types observed on the live
 * columns (`nvarchar(50)` and `nvarchar(2)`), both nullable, matching every
 * row that predates them.
 */

async function tableExists(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.tables WHERE name = '${name}'`
  );
  return rows.length > 0;
}

async function columnExists(queryInterface, table, column) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS present FROM sys.columns WHERE object_id = OBJECT_ID('${table}') AND name = '${column}'`
  );
  return rows.length > 0;
}

/** Row count, or -1 if the table does not exist. Used by `down` to decide whether removing an object would destroy data. */
async function rowCount(queryInterface, table) {
  if (!(await tableExists(queryInterface, table))) return -1;
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS n FROM [${table}]`
  );
  return rows[0].n;
}

const CREATE_FILM = `
CREATE TABLE [dbo].[film](
	[Film_strCode] [varchar](20) NOT NULL,
	[Film_strTitle] [varchar](500) NULL,
	[Film_strCensor] [varchar](10) NULL,
	[Film_strContent] [nvarchar](255) NULL,
	[Film_strDescription] [varchar](255) NULL,
	[Film_strShortName] [varchar](10) NULL,
	[Film_strSignText] [varchar](20) NULL,
	[Film_bytSignSequence] [tinyint] NULL,
	[FilmCat_strCode] [varchar](10) NULL,
	[FilmCat_strName] [varchar](30) NULL,
	[FilmCat_strShortName] [varchar](10) NULL,
	[Film_strChildren] [varchar](1) NULL,
	[Film_intDuration] [smallint] NULL,
	[Film_strStatus] [varchar](1) NULL,
	[Film_strATMAvailable] [char](1) NULL,
	[Film_strShortCode] [nvarchar](15) NULL,
	[Film_intIVRCode] [int] NULL,
	[Film_strURL1] [varchar](255) NULL,
	[Film_strURL2] [varchar](255) NULL,
	[Film_strVCode] [varchar](5) NULL,
	[Film_strTitleAlt] [nvarchar](50) NULL,
	[Film_strCensorAlt] [nvarchar](4) NULL,
	[Film_strContentAlt] [nvarchar](255) NULL,
	[Film_strDescriptionAlt] [nvarchar](255) NULL,
	[Film_strShortNameAlt] [nvarchar](10) NULL,
	[Film_strSignTextAlt] [nvarchar](20) NULL,
	[Film_strURL1Description] [nvarchar](100) NULL,
	[Film_strURL2Description] [nvarchar](100) NULL,
	[Film_strURLforGraphic] [varchar](255) NULL,
	[Film_strURLforFilmName] [varchar](255) NULL,
	[Film_strURLforTrailer] [varchar](255) NULL,
	[Film_strMovieFormat] [nvarchar](30) NULL,
	[Film_strSoundFormat] [nvarchar](30) NULL,
	[Film_mnyGross] [money] NULL,
	[Film_mnyLocalGross] [money] NULL,
	[Film_strUpcomingFlag] [varchar](1) NULL,
	[Film_strFeatureFlag] [varchar](1) NULL,
	[Film_strNowShowingFlag] [varchar](1) NULL,
	[Film_dtmOpeningDate] [datetime] NULL,
	[Film_strDescriptionLong] [ntext] NULL,
	[Film_strAdditionalData] [varchar](1000) NULL,
	[Film_strSalesChannels] [varchar](500) NULL,
	[Film_dtmStamp] [datetime] NOT NULL,
	[test_column] [nchar](1000) NULL,
 CONSTRAINT [PK_Film] PRIMARY KEY CLUSTERED
(
	[Film_strCode] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]`;

const FILM_DEFAULT = `ALTER TABLE [dbo].[film] ADD CONSTRAINT [DF_Film_Film_dtmStamp] DEFAULT (getdate()) FOR [Film_dtmStamp]`;

const CREATE_SESSION = `
CREATE TABLE [dbo].[session](
	[Code] [varchar](10) NOT NULL,
	[Session_lngSessionId] [int] NOT NULL,
	[Film_strCode] [varchar](20) NULL,
	[Screen_bytNum] [int] NULL,
	[Layout_intId] [int] NULL,
	[Screen_strName] [varchar](25) NULL,
	[Session_strStatus] [varchar](1) NOT NULL,
	[Session_strType] [varchar](1) NULL,
	[Session_dtmRealShow] [datetime] NOT NULL,
	[Session_dtmFinishShow] [datetime] NOT NULL,
	[PGroup_strCode] [varchar](4) NOT NULL,
	[Session_intSeatsAvail] [int] NOT NULL,
	[Session_intSeatsTotal] [int] NULL,
	[Session_strSeatAllocation] [varchar](1) NOT NULL,
	[Session_strComments] [nvarchar](255) NOT NULL,
	[Session_dtmFilmFirstShow] [datetime] NULL,
	[Session_strHOSessionID] [varchar](10) NULL,
	[Event_strCode] [varchar](10) NULL,
	[Event_strName] [nvarchar](100) NULL,
	[Session_strAdditionalData] [varchar](1000) NULL,
	[Session_dtmStamp] [datetime] NOT NULL,
	[Session_strSalesChannel] [varchar](500) NULL,
	[CinOperator_strCode] [varchar](10) NULL,
	[Session_strCinemaPopUpDesc] [varchar](10) NULL,
 CONSTRAINT [PK_Session] PRIMARY KEY CLUSTERED
(
	[Code] ASC,
	[Session_lngSessionId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]`;

const SESSION_DEFAULT = `ALTER TABLE [dbo].[session] ADD CONSTRAINT [DF_Session_Session_dtmStamp] DEFAULT (getdate()) FOR [Session_dtmStamp]`;

const SESSION_FK_FILM = `ALTER TABLE [dbo].[session] WITH CHECK ADD CONSTRAINT [FK_Session_Film] FOREIGN KEY([Film_strCode]) REFERENCES [dbo].[film] ([Film_strCode])`;
const SESSION_FK_FILM_CHECK = `ALTER TABLE [dbo].[session] CHECK CONSTRAINT [FK_Session_Film]`;

const SESSION_FK_CINEMAS = `ALTER TABLE [dbo].[session] WITH CHECK ADD CONSTRAINT [FK_Session_cinemas] FOREIGN KEY([Code]) REFERENCES [dbo].[cinemas] ([code])`;
const SESSION_FK_CINEMAS_CHECK = `ALTER TABLE [dbo].[session] CHECK CONSTRAINT [FK_Session_cinemas]`;

/**
 * Unnamed constraints throughout, matching the client's own `screen_layout` -
 * its PK, default and foreign keys all carry SQL Server's auto-generated
 * hash names, which is what happens when a CREATE TABLE does not name them.
 */
const CREATE_SCREEN_LAYOUT = `
CREATE TABLE [dbo].[screen_layout](
	[id] [int] IDENTITY(1,1) NOT NULL,
	[cinema_id] [int] NOT NULL,
	[screen_name] [varchar](50) NOT NULL,
	[category] [varchar](50) NOT NULL,
	[seat_row] [varchar](2) NOT NULL,
	[seat_no] [varchar](3) NOT NULL,
	[is_active] [bit] NOT NULL,
	[created_by] [int] NULL,
	[updated_by] [int] NULL,
	[created_at] [datetime2](7) NOT NULL,
	[updated_at] [datetime2](7) NOT NULL,
 PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY]`;

const SCREEN_LAYOUT_DEFAULT = `ALTER TABLE [dbo].[screen_layout] ADD DEFAULT ((1)) FOR [is_active]`;
const SCREEN_LAYOUT_FK_CINEMA = `ALTER TABLE [dbo].[screen_layout] WITH CHECK ADD FOREIGN KEY([cinema_id]) REFERENCES [dbo].[cinemas] ([id])`;
const SCREEN_LAYOUT_FK_CREATED_BY = `ALTER TABLE [dbo].[screen_layout] WITH CHECK ADD FOREIGN KEY([created_by]) REFERENCES [dbo].[users] ([id])`;
const SCREEN_LAYOUT_FK_UPDATED_BY = `ALTER TABLE [dbo].[screen_layout] WITH CHECK ADD FOREIGN KEY([updated_by]) REFERENCES [dbo].[users] ([id])`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    // film must exist before session, which references it.
    if (!(await tableExists(queryInterface, 'film'))) {
      await q(CREATE_FILM);
      await q(FILM_DEFAULT);
    }

    if (!(await tableExists(queryInterface, 'session'))) {
      await q(CREATE_SESSION);
      await q(SESSION_DEFAULT);
      await q(SESSION_FK_FILM);
      await q(SESSION_FK_FILM_CHECK);
      await q(SESSION_FK_CINEMAS);
      await q(SESSION_FK_CINEMAS_CHECK);
    }

    if (!(await tableExists(queryInterface, 'screen_layout'))) {
      await q(CREATE_SCREEN_LAYOUT);
      await q(SCREEN_LAYOUT_DEFAULT);
      await q(SCREEN_LAYOUT_FK_CINEMA);
      await q(SCREEN_LAYOUT_FK_CREATED_BY);
      await q(SCREEN_LAYOUT_FK_UPDATED_BY);
    }

    if (!(await columnExists(queryInterface, 'screens', 'category'))) {
      await q(`ALTER TABLE [dbo].[screens] ADD [category] [nvarchar](50) NULL`);
    }

    if (!(await columnExists(queryInterface, 'screens', 'seat_row'))) {
      await q(`ALTER TABLE [dbo].[screens] ADD [seat_row] [nvarchar](2) NULL`);
    }
  },

  /**
   * Deliberately conservative. This migration's `up` never touches a
   * database where these objects already hold the client's data, and `down`
   * keeps that guarantee symmetric: it only removes an object if doing so
   * cannot destroy anything.
   *
   * - `session` / `film` are dropped only if empty (0 rows). `session` is
   *   checked and dropped before `film`, since it holds the foreign key.
   * - `screens.category` / `seat_row` are dropped only if every value in the
   *   column is NULL - i.e. nothing has ever been written to it through this
   *   database.
   * - `screen_layout` is never dropped automatically, even when empty. An
   *   empty table cannot be distinguished from "this migration created it on
   *   a fresh database" versus "the client's own backup already had it,
   *   empty" - and the second case is real: the client's database currently
   *   has 0 rows in it too. Removing a table the client supplied, even with
   *   nothing in it, is not this migration's call to make automatically.
   *
   * On a freshly provisioned, still-empty database this fully reverses `up`.
   * On the client's database - where every one of these objects already has
   * data - `down` finds real rows or real values everywhere and leaves
   * everything in place, logging what it skipped instead of raising an
   * error.
   */
  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const skipped = [];

    if (await tableExists(queryInterface, 'session')) {
      const n = await rowCount(queryInterface, 'session');
      if (n === 0) {
        await q('DROP TABLE [dbo].[session]');
      } else {
        skipped.push(`session (${n} row(s))`);
      }
    }

    if (await tableExists(queryInterface, 'film')) {
      // Cannot drop while `session` still references it.
      const sessionGone = !(await tableExists(queryInterface, 'session'));
      const n = await rowCount(queryInterface, 'film');
      if (n === 0 && sessionGone) {
        await q('DROP TABLE [dbo].[film]');
      } else if (n !== 0) {
        skipped.push(`film (${n} row(s))`);
      } else {
        skipped.push('film (session still references it)');
      }
    }

    // Never auto-dropped - see the doc comment above `down`.
    if (await tableExists(queryInterface, 'screen_layout')) {
      skipped.push('screen_layout (never removed automatically; drop manually if truly unwanted)');
    }

    for (const [column, table] of [
      ['category', 'screens'],
      ['seat_row', 'screens'],
    ]) {
      if (!(await columnExists(queryInterface, table, column))) continue;

      const [[{ nonNull }]] = await queryInterface.sequelize.query(
        `SELECT COUNT(*) AS nonNull FROM [${table}] WHERE [${column}] IS NOT NULL`
      );

      if (nonNull === 0) {
        await q(`ALTER TABLE [dbo].[${table}] DROP COLUMN [${column}]`);
      } else {
        skipped.push(`${table}.${column} (${nonNull} non-null value(s))`);
      }
    }

    if (skipped.length > 0) {
      console.warn(
        `20260824000100-provision-client-schema: down() left the following in place ` +
          `because removing them would destroy data: ${skipped.join(', ')}.`
      );
    }
  },
};
