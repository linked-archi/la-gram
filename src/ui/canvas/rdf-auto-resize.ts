/**
 * Containers grow to hold what is inside them.
 *
 * diagram-js's `AutoResize` already does the work — after a shape is created,
 * moved or resized inside another, it widens the container (and its own
 * containers) to fit, as part of the same command, so undo shrinks it again.
 * Which containers may grow is the `element.autoResize` rule (`RdfRules`:
 * every element). This sets the margins: room above for the container's name,
 * which moves to the top once something is inside it.
 */

import AutoResize from 'diagram-js/lib/features/auto-resize/AutoResize.js';

type Margins = { top: number; bottom: number; left: number; right: number };

export class RdfAutoResize extends AutoResize {
  static $inject = ['eventBus', 'elementRegistry', 'modeling', 'rules'];

  /** How far the container reaches past what is inside, once it has to grow. */
  override getOffset(): Margins {
    return { top: 36, bottom: 16, left: 16, right: 16 };
  }

  /** How close to the container's edge something may come before it grows. */
  override getPadding(): Margins {
    return { top: 30, bottom: 8, left: 8, right: 8 };
  }
}

/** diagram-js module: {@link RdfAutoResize} in place of the abstract one. */
export const rdfAutoResizeModule = {
  __init__: ['autoResize'],
  autoResize: ['type', RdfAutoResize],
};
