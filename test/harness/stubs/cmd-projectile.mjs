const calls = [];

export const ProjectileCmd = {
  calls,
  Create(model, scene, x, row, cfg) {
    calls.push({
      kind: "create",
      model: model?.name ?? "Unknown",
      scene,
      x,
      row,
      cfg: { ...cfg },
    });
  },
  CreateLaser(scene, x, row, cfg) {
    calls.push({ kind: "laser", scene, x, row, cfg: { ...cfg } });
  },
  CreateExplosion(scene, x, row, cfg) {
    calls.push({ kind: "explosion", scene, x, row, cfg: { ...cfg } });
  },
  reset() { calls.length = 0; },
};
