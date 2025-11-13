// store/syncStore.js
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Deep equality checks (unchanged)
const vectorEqual = (v1, v2, tolerance = 0.001) => {
  if (!v1 || !v2) return false;
  return (
    Math.abs(v1[0] - v2[0]) < tolerance &&
    Math.abs(v1[1] - v2[1]) < tolerance &&
    Math.abs(v1[2] - v2[2]) < tolerance
  );
};

const quatEqual = (q1, q2, tolerance = 0.01) => {
  if (!q1 || !q2) return false;
  return (
    Math.abs(q1[0] - q2[0]) < tolerance &&
    Math.abs(q1[1] - q2[1]) < tolerance &&
    Math.abs(q1[2] - q2[2]) < tolerance &&
    Math.abs(q1[3] - q2[3]) < tolerance
  );
};

// Throttle/Debounce helpers (unchanged)
const createThrottle = (fn, delay) => {
  let lastCall = 0;
  let timeout = null;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      clearTimeout(timeout);
      fn(...args);
    } else {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
      }, delay - (now - lastCall));
    }
  };
};

// syncHelpers.js  (replace the old version)
 const createDebounce = (fn, delay, immediate = false) => {
  let timeout = null;
  let lastArgs = null;               // <-- store latest args
  let lastThis = null;               // <-- store latest `this`

  const later = () => {
    timeout = null;
    if (!immediate) fn.apply(lastThis, lastArgs);
  };

  return function debounced(...args) {
    lastArgs = args;
    lastThis = this;

    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    if (callNow) fn.apply(this, args);
    timeout = setTimeout(later, delay);
  };
};

export const useSyncStore = create(
  subscribeWithSelector((set, get) => {
    let prevPanoPos = null;
    let prevPanoQuat = null;
    let prevForgePos = null;
    let prevForgeQuat = null;
    let rafId = null;

    // ===== SMOOTH INTERPOLATION HELPERS =====
    const lerp = (a, b, t) => a + (b - a) * t;
    const slerp = (q1, q2, t) => {
      const q = new (window.THREE || {}).Quaternion();
      q.slerpQuaternions(q1, q2, t);
      return [q.x, q.y, q.z, q.w];
    };

    const animateSync = (isForge) => {
      const state = get();
      if (!state.isAnimating || state.isSyncing) {
        rafId = null;
        return;
      }

      let t = (Date.now() - state.syncStartTime) / 300; // 300ms duration
      if (t >= 1) {
        t = 1;
        set({ isAnimating: false });
        setTimeout(() => {
        const state = get();
        // if (state.source === (isForge ? 'forge' : 'pano')) {
        //   set({ source: null });
        // }
      }, 50)
      }

      let newPos, newQuat;
      if (isForge) {
        newPos = state.targetForgePose.pos.map((v, i) => lerp(state.forgePosition.x || v, v, t));
        newQuat = slerp(
          [state.forgeCam.quat[0] || 0, state.forgeCam.quat[1] || 0, state.forgeCam.quat[2] || 0, state.forgeCam.quat[3] || 1],
          state.targetForgePose.quat,
          t
        );
      } else {
        newPos = state.targetPanoPose.pos.map((v, i) => lerp(state.panoPosition.x || v, v, t));
        const quat=state.panoCam.quat || state.panoCam.pos.quat  ;
        //console.log("state",state.panoCam);
        newQuat = slerp(
          [quat[0] || 0, quat[1] || 0, quat[2] || 0, quat[3] || 1],
          state.targetPanoPose.quat,
          t
        );
      }

      if (t < 1) {
        if (isForge) {
          set({
            forgePosition: { x: newPos[0], y: newPos[1], z: newPos[2] },
            forgeCam: { ...state.forgeCam, quat: newQuat },
          });
        } else {
          set({
            panoPosition: { x: newPos[0], y: newPos[1], z: newPos[2] },
            panoCam: { ...state.panoCam, quat: newQuat },
          });
        }
        rafId = requestAnimationFrame(() => animateSync(isForge));
      }
    };

    return {
      // ===== SHARED STATE =====
      calibration: { scale: 1, offset: { x: 0, y: 0, z: 0 } },

      panoCam: {
        pos: [1.2246467991473532e-16, -14.142135623730951, 23.14213562373095],
        quat: [0, 1, 0, 6.123233995736766e-17],
      },
      forgeCam: { pos: [69.6, 93.6, 5.91], quat: [0.0, 0.7071, 0.0, 0.7071] },

      panoPosition: { x: 0, y: 0, z: 0 },
      forgePosition: { x: 0, y: 0, z: 0 },

      // ===== SMOOTH ANIMATION STATE =====
      targetPanoPose: null,
      targetForgePose: null,
      isAnimating: false,
      syncStartTime: 0,

      // ===== SYNC TRACKING =====
      isSyncing: false,
      source: null, // 'pano' | 'forge' | null
      lastSyncTime: 0,
      syncInProgress: false,
      syncCount: 0,
      isUserInitiated: false,
      floorClick: null,
      floorClickSeq: 0,
      frameIdx: 0,

      pathPoints: [],
      currentPanoIndex: 0,
      calibration: null,
      panoJumpRequest: null,

      // ===== CORE SETTERS =====
      setPathPoints: (points) => set({ pathPoints: points }),
      setCurrentPanoIndex: (idx) => set({ currentPanoIndex: idx }),
      setCalibration: (calib) => set({ calibration: calib }),
      setPanoJumpRequest: (fn) => set({ panoJumpRequest: fn }),
      setFrameIdx: (idx) => set({ frameIdx: idx }),
      setIsUserInitiated: (v) => set({ isUserInitiated: v }),
      setIsSyncing: (v) => set({ isSyncing: v }),
      setSource: (src) => set({ source: src }),
      pushFloorClick: (pos, meta = null) =>
        set((s) => ({
          floorClick: { pos, meta, seq: s.floorClickSeq + 1, ts: Date.now() },
          floorClickSeq: s.floorClickSeq + 1,
          lastSyncTime: Date.now(),
        })),

      // ===== SMOOTH SYNC ACTIONS =====
      smoothSyncPano: (pos, quat) => {
        const changed = !vectorEqual(pos, get().panoPosition) || !quatEqual(quat, get().panoCam.quat);
        if (!changed) return;

        set({
          targetPanoPose: { pos, quat },
          isAnimating: true,
          syncStartTime: Date.now(),
          source: 'pano',
          lastSyncTime: Date.now(),
          syncCount: get().syncCount + 1,
        });

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => animateSync(false));
      },

      smoothSyncForge: (pos, quat) => {
        const changed = !vectorEqual(pos, get().forgePosition) || !quatEqual(quat, get().forgeCam.quat);
        if (!changed) return;

        set({
          targetForgePose: { pos, quat },
          isAnimating: true,
          syncStartTime: Date.now(),
          source: 'forge',
          lastSyncTime: Date.now(),
          syncCount: get().syncCount + 1,
        });

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => animateSync(true));
      },

      // ===== LEGACY PUBLISH (instant, for floor clicks) =====
      fromPanoCam: (pos, quat) => {
        if (vectorEqual(pos, prevPanoPos) && quatEqual(quat, prevPanoQuat)) return;
        prevPanoPos = pos;
        prevPanoQuat = quat;
        set({ panoCam: { pos, quat }, source: 'pano', lastSyncTime: Date.now(), syncCount: get().syncCount + 1 });
      },

      fromForgeCam: (pos, quat) => {
     
        if (vectorEqual(pos, prevForgePos) && quatEqual(quat, prevForgeQuat)) return;
        prevForgePos = pos;
        prevForgeQuat = quat;
        set({ forgeCam: { pos, quat }, source: 'forge', lastSyncTime: Date.now(), syncCount: get().syncCount + 1 });
      },

      fromPanoPosition: (pos) => {
        if (vectorEqual(pos, prevPanoPos)) return;
        prevPanoPos = pos;
        set({ panoPosition: pos, source: 'pano', lastSyncTime: Date.now(), syncCount: get().syncCount + 1 });
      },

      fromForgePosition: (pos) => {
        if (vectorEqual(pos, prevForgePos)) return;
        prevForgePos = pos;
        set({ forgePosition: pos, source: 'forge', lastSyncTime: Date.now(), syncCount: get().syncCount + 1 });
      },

      // ===== SILENT ACTIONS =====
      setPanoCam: (pos, quat) => set((s) => ({ panoCam: { pos, quat } })),
      setForgeCam: (pos, quat) => set((s) => ({ forgeCam: { pos, quat } })),
      setPanoPosition: (pos) => set({ panoPosition: pos }),
      setForgePosition: (pos) => set({ forgePosition: pos }),

      // ===== CONVENIENCE =====
      applyForgePose: (pos, quat, { smooth = true, publish = false } = {}) =>
        smooth
          ? get().smoothSyncForge(pos, quat)
          : set((s) =>
              publish
                ? {
                    forgeCam: { pos, quat },
                    forgePosition: pos,
                    source: 'forge',
                    lastSyncTime: Date.now(),
                    syncCount: s.syncCount + 1,
                  }
                : { forgeCam: { pos, quat }, forgePosition: pos }
            ),

      applyPanoPose: (pos, quat, { smooth = true, publish = false } = {}) =>
        smooth
          ? get().smoothSyncPano(pos, quat)
          : set((s) =>
              publish
                ? {
                    panoCam: { pos, quat },
                    panoPosition: pos,
                    source: 'pano',
                    lastSyncTime: Date.now(),
                    syncCount: s.syncCount + 1,
                  }
                : { panoCam: { pos, quat }, panoPosition: pos }
            ),

      // ===== HELPERS =====
      startSync: () => set({ isSyncing: true, syncInProgress: true }),
      endSync: () => set({ isSyncing: false, syncInProgress: false }),
      canSync: (minIntervalMs = 200) => Date.now() - get().lastSyncTime >= minIntervalMs,
      getSyncDelta: () => Date.now() - get().lastSyncTime,
      resetSyncCount: () => set({ syncCount: 0 }),
    };
  })
);

export const syncHelpers = {
  createThrottle,
  createDebounce,
  vectorEqual,
  quatEqual,
};

export const useSyncMonitor = () => {
  const state = useSyncStore();
  return {
    isSyncing: state.isSyncing,
    source: state.source,
    lastSyncTime: state.lastSyncTime,
    syncCount: state.syncCount,
    isAnimating: state.isAnimating,
    canSync: state.canSync,
    getSyncDelta: state.getSyncDelta,
  };
};