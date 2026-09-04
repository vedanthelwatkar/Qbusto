'use strict';

/**
 * Wires every implemented POS adapter into the registry.
 *
 * Requiring this module registers adapters as a side effect; it exists so
 * `src/app.js` has one line to require instead of reaching into `src/pos/`
 * for each provider it knows about. Vista (B3) and Impact have no adapter
 * yet, so this module registers only what Phase B4 actually built.
 */

const { registerAdapter } = require('./providerRegistry');
const { POS_PROVIDERS } = require('../constants');
const showbizAdapter = require('./showbizAdapter');

registerAdapter(POS_PROVIDERS.SHOWBIZZ, showbizAdapter);
