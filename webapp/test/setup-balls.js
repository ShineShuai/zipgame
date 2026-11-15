// The ball boards are in a catalog of their own that the apps load when needed; the unit tests have it.
import { BALL_CATALOG } from '../src/core/solid/ball-catalog.js';
import { registerBalls } from '../src/core/solid/ball-registry.js';

registerBalls(BALL_CATALOG);
