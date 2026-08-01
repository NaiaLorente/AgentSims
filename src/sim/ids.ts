/**
 * Plain sequential-number ids ("1", "2", "3"...) for anything a model has to
 * read back and reproduce verbatim (agent ids). Small local models are
 * unreliable at faithfully copying long opaque tokens across turns — a short
 * number is much easier to carry through a prompt correctly.
 */
function makeCounter() {
  let n = 0;
  return {
    next: (): string => {
      n += 1;
      return String(n);
    },
    reset: (): void => {
      n = 0;
    },
    /** Loaded saves bring their own ids in from outside this counter — make sure the next
     *  freshly-generated id can't collide with one of those. */
    ensureAbove: (ids: Iterable<string>): void => {
      for (const id of ids) {
        const parsed = Number(id);
        if (Number.isInteger(parsed) && parsed > n) n = parsed;
      }
    },
  };
}

export const agentIdCounter = makeCounter();
