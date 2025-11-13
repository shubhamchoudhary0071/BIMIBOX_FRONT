/** ForgeViewer.jsx */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { getOAuthToken } from "../lib/api";
import { useSyncStore, syncHelpers } from "../store/syncStore";
import { calculateCalibration, panoToForge,  } from "../utils/calibratePanoToForge";
import {  transformQuaternion, transformQuaternionMirrored } from "../utils/camera_transformation";

const THREE = (typeof window !== "undefined" && window.THREE) ? window.THREE : null;

export default function ForgeViewer({ urn }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const isUserInitiatedRef = useRef(true);
  const throttledPushCamRef = useRef(null);
const lastProgrammaticTokenRef = useRef(null);
const PROGRAMMATIC_TOKEN_EXPIRY_MS = 350; // increase slightly so network/raf latency won't keep it set

    // ✅ NEW: Track user input DIRECTLY via DOM events
  const userInputRef = useRef({
    isUserInteracting: false,
    lastInteractionTime: 0,
  });
   const programmaticChangeRef = useRef(false);


  const [viewerReady, setViewerReady] = useState(false);
  const [calibration, setCalibration] = useState(null);

  // Store selectors
  const source = useSyncStore((s) => s.source);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const floorClick = useSyncStore((s) => s.floorClick);
  const floorClickSeq = useSyncStore((s) => s.floorClickSeq);
  const panoCam = useSyncStore((s) => s.panoCam);

  const setIsSyncing = useSyncStore((s) => s.setIsSyncing);
  const setForgeCam = useSyncStore((s) => s.setForgeCam);

  const lastHandledClickSeqRef = useRef(0);

  /* ------------------------------------------------------------------ */
  /* Helper utilities                                                   */
  /* ------------------------------------------------------------------ */
  const getUnitScale = (viewer) => {
    return viewer?.model?.getUnitScale?.() ?? 1.0;
  };

  const worldToViewerLocal = useCallback((worldX, worldY, worldZ, viewer) => {
    if (!THREE) return null;
    const go = viewer?.model?.getData?.()?.globalOffset || { x: 0, y: 0, z: 0 };
    const unitScale = getUnitScale(viewer);
    const modelX = (worldX / unitScale) - go.x;
    const modelY = (worldY / unitScale) - go.y;
    const modelZ = (worldZ / unitScale) - go.z;
    return new THREE.Vector3(modelX, modelY, modelZ);
  }, []);

  const viewerLocalToWorld = useCallback((localVec, viewer) => {
    if (!THREE) return null;
    const go = viewer?.model?.getData?.()?.globalOffset || { x: 0, y: 0, z: 0 };
    const unitScale = getUnitScale(viewer);
    const rawX = localVec.x + go.x;
    const rawY = localVec.y + go.y;
    const rawZ = localVec.z + go.z;
    return [rawX * unitScale, rawY * unitScale, rawZ * unitScale];
  }, []);

  /* ------------------------------------------------------------------ */
  /* 1. Load calibration (once)                                         */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const raw = localStorage.getItem("revit-pano-calibration-v2");
    if (!raw) {
      console.warn("[CALIB] No calibration in localStorage");
      return;
    }
    try {
      const pts = JSON.parse(raw);
      const panoPts = pts.map((p) => [
        parseFloat(p.pano.x),
        parseFloat(p.pano.y),
        parseFloat(p.pano.z),
      ]);
      const revitPts = pts.map((p) => [
        parseFloat(p.revit.x),
        parseFloat(p.revit.y),
        parseFloat(p.revit.z),
      ]);
      const calib = calculateCalibration(panoPts, revitPts);
      setCalibration(calib);
      console.log("[CALIB] Calibration loaded", calib);
    } catch (e) {
      console.error("[CALIB] Parse error", e);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /* 2. Throttled camera push (user-initiated only)                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    throttledPushCamRef.current = syncHelpers.createThrottle(() => {
      if (!viewerRef.current || useSyncStore.getState().isSyncing) return;

      const viewer = viewerRef.current;
      const cam = viewer.navigation.getCamera?.();
      if (!cam || !THREE) return;

      const localPos = cam.position.clone();
      const [worldX, worldY, worldZ] = viewerLocalToWorld(localPos, viewer);
      const q = cam.quaternion;

      setForgeCam([worldX, worldY, worldZ], [q.x, q.y, q.z, q.w]);
    }, 200);
  }, [viewerLocalToWorld, setForgeCam]);

  /* ------------------------------------------------------------------ */
  /* 3. Floor-click handler                                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !THREE || !calibration) return;

    const fc = floorClick;
    if (!fc || fc.seq === lastHandledClickSeqRef.current) return;

    const viewer = viewerRef.current;
    const [x, y, z = 0] = fc.pos;

    try {
      setIsSyncing(true);

      const panoPt = [x, y, z];
      const [forgeX, forgeY, forgeZ] = panoToForge(panoPt, calibration);

      const posLocal = worldToViewerLocal(forgeX, forgeY, forgeZ, viewer);
      const targetLocal = posLocal.clone().add(new THREE.Vector3(0, -20, 0));

      viewer.navigation.toPerspective();
      viewer.navigation.setPosition(posLocal);
      viewer.navigation.setTarget(targetLocal);
      viewer.navigation.up?.set(0, 0, 1);
      viewer.impl.sceneUpdated(true);

  
    } catch (e) {
      console.error("[FORGE] Floor click nav failed", e);
    } finally {
      setIsSyncing(false);
      lastHandledClickSeqRef.current = fc.seq;
    }
  }, [viewerReady, floorClickSeq, calibration, setIsSyncing, worldToViewerLocal]);

  /* ------------------------------------------------------------------ */
  /* 4. Viewer helpers                                                  */
  /* ------------------------------------------------------------------ */
  const removeAllRotationConstraints = useCallback((viewer) => {
    try {
      const nav = viewer.navigation;
      nav.toPerspective?.();
      nav.setWorldUpVector?.(new THREE.Vector3(0, 0, 1));
      nav.up?.set(0, 0, 1);
      const cam = nav.getCamera?.();
      if (cam) {
        cam.minPolarAngle = -Math.PI;
        cam.maxPolarAngle = Math.PI;
        cam.minAzimuthAngle = -Infinity;
        cam.maxAzimuthAngle = Infinity;
        cam.up?.set(0, 0, 1);
        cam.freeOrbit = true;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const enableBimWalk = useCallback(async (viewer) => {
    try {
      const ext = await viewer.loadExtension("Autodesk.BimWalk");
      if (!ext) throw new Error("BimWalk not found");
      ext.activate();
      viewer.navigation.toPerspective();
      viewer.impl.sceneUpdated(true);
      const tool = ext.tool || ext;
      tool.setGravity?.(false);
      tool.setLockElevation?.(false);
      tool.setVerticalMovement?.(true);
      return ext;
    } catch (e) {
      console.warn("[FORGE] BimWalk unavailable", e);
      return null;
    }
  }, []);

  const moveCameraToStart = useCallback(
    (viewer, startMetersX = null, startMetersY = null, startMetersZ = null) => {
      if (!THREE) return;

      let worldX = startMetersX;
      let worldY = startMetersY;
      let worldZ = startMetersZ ?? 0;

      if (worldX === null || worldY === null) {
        if (calibration) {
          const {x,y,z} = panoToForge([0, 0, 0], calibration);
          worldX = x;
          worldY = y
          worldZ = z;
        } else {
          const scale = viewer ? getUnitScale(viewer) : 0.3048;
          worldX = 69.6 * scale;
          worldY = 93.6 * scale;
          worldZ = 8 * scale;
        }
      }

      const posLocal = new THREE.Vector3(worldX, worldY, worldZ);
      const target = posLocal.clone().add(new THREE.Vector3(0, -20, 0));

      viewer.navigation.toPerspective();
      viewer.navigation.setPosition(posLocal);
      viewer.navigation.setTarget(target);
      viewer.navigation.up?.set(0, 0, 1);
      viewer.impl.sceneUpdated(true);

  
    },
    [calibration]
  );

  /* ------------------------------------------------------------------ */
  /* 5. Viewer init                                                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    (async () => {
      try {
        const token = await getOAuthToken(["data:read", "viewables:read"]);
        const opts = {
          env: "AutodeskProduction",
          api: "derivativeV2",
          getAccessToken: (cb) => cb(token.access_token, token.expires_in),
        };

        await new Promise((res, rej) =>
          window?.Autodesk?.Viewing?.Initializer
            ? window.Autodesk.Viewing.Initializer(opts, res, rej)
            : rej(new Error("Forge Viewer not available"))
        );

        const viewer = new window.Autodesk.Viewing.GuiViewer3D(containerRef.current);
        viewerRef.current = viewer;
        window.viewer = viewer;

        if (viewer.start() !== 0) throw new Error("viewer.start() failed");

        const doc = await new Promise((resolve, reject) => {
          window.Autodesk.Viewing.Document.load(
            urn,
            (d) => resolve(d),
            (code, msg) => reject(new Error(`Doc load error ${code}: ${msg}`))
          );
        });

        const root = doc?.getRoot?.();
        if (!root) throw new Error("Invalid document – no root");

        const viewables = root.search({ type: "geometry" });
        if (!viewables?.length) throw new Error("No geometry in model");

        await viewer.loadDocumentNode(doc, viewables[0]);

        removeAllRotationConstraints(viewer);
        viewer.fitToView();

        const ext = await enableBimWalk(viewer);
        if (ext) {
          setTimeout(() => {
            moveCameraToStart(viewer);
            removeAllRotationConstraints(viewer);
            setViewerReady(true);
          }, 800);
        } else {
          moveCameraToStart(viewer);
          setViewerReady(true);
        }

        setTimeout(() => removeAllRotationConstraints(viewer), 1500);
      } catch (err) {
        console.error("[FORGE] Init error:", err);
        alert(`Failed to load model: ${err.message}`);
      }
    })();
  }, [urn, enableBimWalk, removeAllRotationConstraints, moveCameraToStart]);

/* ================================================================== */
/* 6. Camera change listener – USER-INITIATED (FIXED - Direct Events) */
/* ================================================================== */
useEffect(() => {
  if (!viewerReady || !viewerRef.current) return;

  const viewer = viewerRef.current;
  const V = window?.Autodesk?.Viewing;
  if (!V) return;



  // ✅ NEW: Track programmatic changes
 
  const stateRef = {
    isSyncing: useSyncStore.getState().isSyncing,
  };
  const unsubscribeSync = useSyncStore.subscribe(
    (state) => {
      stateRef.isSyncing = state.isSyncing;
    },
    (state) => [state.isSyncing]
  );

 
  let lastCameraState = { pos: null, quat: null };

  const onCameraChange = () => {
    // ✅ SKIP if programmatic change is happening

    console.log("triggering camera change",lastProgrammaticTokenRef.current)
     if (lastProgrammaticTokenRef.current !== null) {
    return;
  }
 
   

    const cam = viewer.navigation.getCamera?.();
    if (!cam || !THREE) return;

    const localPos = cam.position.clone();
    const [worldX, worldY, worldZ] = viewerLocalToWorld(localPos, viewer);
    const q = cam.quaternion;

    const pos = [worldX, worldY, worldZ];
    const quat = [q.x, q.y, q.z, q.w];

    // Filter noise
    const posChanged =
      !lastCameraState.pos ||
      lastCameraState.pos.some((v, i) => Math.abs(v - pos[i]) > 0.01);
    const quatChanged =
      !lastCameraState.quat ||
      lastCameraState.quat.some((v, i) => Math.abs(v - quat[i]) > 0.001);

    if (!posChanged && !quatChanged) {
      console.log("[FORGE] Rejected – no significant position/rotation change");
      return;
    }

    lastCameraState = { pos: pos.slice(), quat: quat.slice() };

    console.log("[FORGE] ✅ ACCEPTED USER camera change → pushing to store", {
      pos,
      quat,
    });

    useSyncStore.setState({ source: "forge" });
 
    setForgeCam(pos, quat);
    useSyncStore.getState().smoothSyncForge(pos, quat);
  };

  viewer.addEventListener(V.CAMERA_CHANGE_EVENT, onCameraChange);



  return () => {
 
    viewer.removeEventListener(V.CAMERA_CHANGE_EVENT, onCameraChange);
    unsubscribeSync();
  };
}, [viewerReady, viewerLocalToWorld, setForgeCam]);



  /* ------------------------------------------------------------------ */
  /* 7. MAIN SYNC: pano → viewer (no store update)                      */
  /* ------------------------------------------------------------------ */
useEffect(() => {
  if (!viewerRef.current || !THREE || !calibration) return;

  // --------------------------------------------------------------
  // 1. Block if already syncing
  // --------------------------------------------------------------
  if (isSyncing) {
    console.log("[SYNC] Blocked – already syncing", { isSyncing });
    return;
  }

  // --------------------------------------------------------------
  // 2. Validate panoCam structure + numeric values
  // --------------------------------------------------------------
  if (!panoCam || !panoCam.pos || !panoCam.quat) {
    console.log("[SYNC] Invalid panoCam: missing pos/quat");
    return;
  }

  const { pos, quat } = panoCam;

  // Check pos: [x, y, z] all numbers
  if (
    !Array.isArray(pos) ||
    pos.length !== 3 ||
    pos.some(v => typeof v !== "number" || isNaN(v))
  ) {
    console.log("[SYNC] Invalid panoCam.pos – not valid [x,y,z] numbers", pos);
    return;
  }

  // Check quat: [x, y, z, w] all numbers
  if (
    !Array.isArray(quat) ||
    quat.length !== 4 ||
    quat.some(v => typeof v !== "number" || isNaN(v))
  ) {
    console.log("[SYNC] Invalid panoCam.quat – not valid [x,y,z,w] numbers", quat);
    return;
  }

  // --------------------------------------------------------------
  // 3. Mark this sync with a unique token
  // --------------------------------------------------------------
  const token = Math.random();
  lastProgrammaticTokenRef.current = token;

  const viewer = viewerRef.current;
  const nav = viewer.navigation;

  try {
    setIsSyncing(true);
    console.log("=== [SYNC] Pano → Forge START ===");

    const panoPts = [pos[0], pos[1], pos[2]];
    console.log("panoPts", panoPts);

    // ----------------------------------------------------------
    // 1. POSITION – Keep Z height constant
    // ----------------------------------------------------------
    const [forgeX, forgeY, forgeZ] = panoToForge(panoPts, calibration);
    const currentEyeLocal = nav.getPosition(); // local coords
    const [curX, curY, curZ] = viewerLocalToWorld(currentEyeLocal, viewer);

    const finalWorldZ = !isNaN(curZ) ? curZ : forgeZ; // fallback if viewer not ready
    console.log("[SYNC] Eye (world) → X,Y,Z:", [forgeX, forgeY, finalWorldZ]);

    const posLocal = worldToViewerLocal(forgeX, forgeY, finalWorldZ, viewer);

    // ----------------------------------------------------------
    // 2. ROTATION
    // ----------------------------------------------------------
    const [qx, qy, qz, qw] = quat;
    const [tx, ty, tz, tw] = transformQuaternion(qx, qy, qz, qw);
    const q = new THREE.Quaternion(tx, ty, tz, tw);

    const pitchDown90 = new THREE.Quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    q.multiply(pitchDown90);

    // ----------------------------------------------------------
    // 3. Forward + Target
    // ----------------------------------------------------------
    const forward = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    console.log("[SYNC] forwardLocal:", forward.toArray().map(v => v.toFixed(3)));

    const targetLocal = posLocal.clone().add(forward.clone().multiplyScalar(10));
    console.log("[SYNC] targetLocal:", targetLocal.toArray().map(v => v.toFixed(3)));

    // ----------------------------------------------------------
    // 4. APPLY
    // ----------------------------------------------------------
    nav.toPerspective();
    nav.setPosition(posLocal);
    nav.setTarget(targetLocal);
    nav.up?.set(0, 0, 1);
    viewer.impl.sceneUpdated(true);

    console.log("[SYNC] Camera set – height locked at", finalWorldZ.toFixed(3), "m");
    console.log("=== [SYNC] Pano → Forge END ===\n");
  } catch (e) {
    console.error("[FORGE] Pano sync error", e);
  } finally {
    setIsSyncing(false);

    // Clear token after a short delay to cover any trailing CAMERA_CHANGE events
    setTimeout(() => {
      if (lastProgrammaticTokenRef.current === token) {
        lastProgrammaticTokenRef.current = null;
      }
    }, 150);
  }
}, [
  panoCam,
  isSyncing,
  calibration,
  worldToViewerLocal,
  setIsSyncing,
  // viewerRef, THREE, etc. are stable
]);
useEffect(()=>{
  console.log("panoCam",panoCam)

},[panoCam])


  /* ------------------------------------------------------------------ */
  /* Helper: navigateToCalibratedPosition (exposed on window)           */
  /* ------------------------------------------------------------------ */
  const navigateToCalibratedPosition = useCallback(
    (worldMetersX, worldMetersY, worldMetersZ = 0) => {
      if (!THREE || !calibration || !viewerRef.current) return;

      const viewer = viewerRef.current;

      const posLocal = new THREE.Vector3(worldMetersX, worldMetersY, worldMetersZ);
      const target = posLocal.clone().add(new THREE.Vector3(0, -20, 0));

      setIsSyncing(true);
      viewer.navigation.toPerspective();
      viewer.navigation.setPosition(posLocal);
      viewer.navigation.setTarget(target);
      viewer.navigation.up?.set(0, 0, 1);
      viewer.impl.sceneUpdated(true);
      setIsSyncing(false);

  
    },
    [calibration, setIsSyncing]
  );

  useEffect(() => {
    if (!window) return;
    window.navigateToCalibratedPosition = navigateToCalibratedPosition;
    return () => {
      delete window.navigateToCalibratedPosition;
    };
  }, [navigateToCalibratedPosition]);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full bg-black" />
    </div>
  );
}