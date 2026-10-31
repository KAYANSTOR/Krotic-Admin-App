export const AGGREGATE_REPAIR_PROGRESS_KEY = 'krotak:aggregate-repair-progress:v1';

const EMPTY_PROGRESS = Object.freeze({
  processed: 0,
  cursor: null,
  done: false,
  completedAt: null,
});

export function loadRepairProgress() {
  try {
    const raw = window.localStorage.getItem(AGGREGATE_REPAIR_PROGRESS_KEY);
    if (!raw) return { ...EMPTY_PROGRESS };

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      return { ...EMPTY_PROGRESS };
    }

    const completedAt = typeof saved.completedAt === 'string' && !Number.isNaN(Date.parse(saved.completedAt))
      ? saved.completedAt
      : null;

    return {
      processed: Math.max(0, Number(saved.processed) || 0),
      cursor: typeof saved.cursor === 'string' && saved.cursor ? saved.cursor : null,
      done: saved.done === true,
      completedAt,
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveRepairProgress(progress) {
  try {
    window.localStorage.setItem(AGGREGATE_REPAIR_PROGRESS_KEY, JSON.stringify({
      processed: Math.max(0, Number(progress?.processed) || 0),
      cursor: typeof progress?.cursor === 'string' && progress.cursor ? progress.cursor : null,
      done: progress?.done === true,
      completedAt: typeof progress?.completedAt === 'string' ? progress.completedAt : null,
    }));
  } catch {
    // Progress persistence is best-effort and applies only to this browser.
  }
}
