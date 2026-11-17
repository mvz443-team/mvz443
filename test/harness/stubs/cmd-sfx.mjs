const calls = [];

export const SfxCmd = {
  calls,
  Create(ctor, args) {
    const name = ctor?.name ?? "Sfx";
    calls.push({ name, args });
    return { play() { return this; }, stop() { return this; }, destroy() { return this; } };
  },
  reset() { calls.length = 0; },
};
