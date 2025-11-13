/*  PathCameraExplorer.jsx – FIXED, OPTIMIZED & USES syncStore */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import { useSyncStore, syncHelpers } from "../store/syncStore";
import {
  buildManhattanPath,
  buildWalkman,
  createCompassCircleXZ,
  fixOverlappingPoints,
  getFacingAnglesFromCamera,
  savitzkyGolay,
} from "../lib/pano_helpers";
import KalmanFilter3D from "../lib/kalman_filter";
import { calculateCalibration, forgeToPano } from "../utils/calibratePanoToForge";
import {  reverseTransform } from "../utils/camera_transformation";

/* ════════════════════════════════════════════════════════════════════════════ */
/*  PathCameraExplorer – Panorama Viewer with Path Navigation                   */
/* ════════════════════════════════════════════════════════════════════════════ */
const PathCameraExplorer = forwardRef((_, ref) => {
  const mountRef = useRef(null);
  const rafRef = useRef(null);
  const lastKeyRef = useRef(null);
    const lastProgrammaticTokenPano = useRef(null);
  

  const isUserDraggingRef = useRef(false);
  const [controlSource, setControlSource] = useState("idle"); // "user" | "sync" | "idle"
  const controlSourceTimeoutRef = useRef(null);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  UI CONTROLS                                                             */
  /* ──────────────────────────────────────────────────────────────────────── */
  const [windowSize, setWindowSize] = useState(15);
  const [polyOrder, setPolyOrder] = useState(3);
  const [processNoise, setProcessNoise] = useState(0.001);
  const [measurementNoise, setMeasurementNoise] = useState(0.01);
  const [camOffset, setCamOffset] = useState({ x: 0, y: 0, z: 0 });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  THREE.js SCENE OBJECTS                                                  */
  /* ──────────────────────────────────────────────────────────────────────── */
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const pathLineRef = useRef(null);
  const panoramaSphereRef = useRef(null);
  const compassGroupRef = useRef(null);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  DATA & STATE                                                            */
  /* ──────────────────────────────────────────────────────────────────────── */
  const dataRef = useRef([]);
  const cameraPathRef = useRef([]);
  const pathIndexRef = useRef(0);
  const textureCache = useRef(new Map());
  const textureLoader = useRef(new THREE.TextureLoader());

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  MOUSE & CAMERA CONTROL                                                  */
  /* ──────────────────────────────────────────────────────────────────────── */
  const mouseStateRef = useRef({ isDragging: false, prevX: 0, prevY: 0 });
  const currentPOVRef = useRef({ yaw: 0, pitch: 0 });
  const camOffsetRef = useRef(camOffset);
  const calibrationRef = useRef(null);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CONSTANTS                                                               */
  /* ──────────────────────────────────────────────────────────────────────── */
  const Z_SCALE = 3.0;
  const LOOK_AHEAD_BEHIND = 20;
  const COMPASS_DISTANCE = 10;
  const COMPASS_RADIUS = 0.7;
  const WALKMAN_SCALE = 0.5;
  const WALKMAN_LIFT = 0;
  const PATH_HEIGHT=0;
  const YAW_MINUS_90 = new THREE.Quaternion(); // ONE instance for the whole component
YAW_MINUS_90.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI ); // -90°


  /* ──────────────────────────────────────────────────────────────────────── */
  /*  SYNC STORE                                                              */
  /* ──────────────────────────────────────────────────────────────────────── */
  const {
    isSyncing,

    setPanoCam,
  
    setPathPoints,
    setCurrentPanoIndex,
    setCalibration,
    forgeCam,
    panoCam,
  } = useSyncStore();

  useEffect(() => {
    camOffsetRef.current = camOffset;
  }, [camOffset]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CONTROL SOURCE INDICATOR                                                */
  /* ──────────────────────────────────────────────────────────────────────── */
  const updateControlSource = useCallback((source) => {
    setControlSource(source);
    
    if (controlSourceTimeoutRef.current) {
      clearTimeout(controlSourceTimeoutRef.current);
    }

    if (source !== "idle") {
      controlSourceTimeoutRef.current = setTimeout(() => {
        setControlSource("idle");
      }, 2000); // Reset to idle after 2 seconds
    }
  }, []);

  /* -------------------------------------------------
     1. Load calibration matrix (once)
  ------------------------------------------------- */
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
      calibrationRef.current=calib
      console.log("calib",calib)
      console.log("[CALIB] matrix loaded", calib);
    } catch (e) {
      console.error("[CALIB] parse error", e);
    }

  }, []);

useEffect(() => {
  if (!cameraRef.current) return;
  
  console.log("[DEBUG] Pano→Forge sync mounted");
  let rafId = null;

  // LIVE STATE REF (captures latest store state)
  const stateRef = {
    isSyncing: useSyncStore.getState().isSyncing,
    source: useSyncStore.getState().source,
  };

  // Subscribe to store changes
  const unsubscribe = useSyncStore.subscribe(
    (state) => {
      stateRef.isSyncing = state.isSyncing;
      stateRef.source = state.source;
    },
    (state) => [state.isSyncing, state.source]
  );

  // Debounce function
  const debouncedSync = syncHelpers.createDebounce(() => {
    console.log("[DEBUG] Debounce fired");

    // Use live state instead of closures
    if (lastProgrammaticTokenPano.current !== null) {
    console.log("Skip pano programmatic sync");
    return;
}
 
    if (!cameraRef.current) {
      console.log("[DEBUG] Camera missing");
      return;
    }

    const pos = cameraRef.current.position;
    const { yaw, pitch } = currentPOVRef.current;

    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

    console.log("[SYNC-PUSH] Pano → Forge:", {
      pos: [pos.x, pos.y, pos.z],
      quat: [q.x, q.y, q.z, q.w],
    });

    // Set source BEFORE pushing
    useSyncStore.setState({ source: "pano" });
    updateControlSource("user");


    const position=dataRef.current[pathIndexRef.current];
    

    // Push to store
    setPanoCam([position.x, position.y, position.z], [q.x, q.y, q.z, q.w]);

    // Trigger smooth sync on Forge
    useSyncStore.getState().smoothSyncPano(
      [position.x, position.y, position.z],
      [q.x, q.y, q.z, q.w]
    );
    setTimeout(()=>{

      useSyncStore.setState({ source: "pano" });
    },300)

  }, 100);

  // RAF loop monitors for position/orientation changes
  const rafLoop = () => {
    const pos = cameraRef.current?.position;
    const pov = currentPOVRef.current;

    if (!pos || pov === undefined) {
      rafId = requestAnimationFrame(rafLoop);
      return;
    }

    // Create a key to detect changes
    const key = `${pos.x.toFixed(3)}-${pos.y.toFixed(3)}-${pos.z.toFixed(3)}-${pov.yaw.toFixed(3)}-${pov.pitch.toFixed(3)}`;
    
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      debouncedSync(); // Trigger debounced sync
    }

    rafId = requestAnimationFrame(rafLoop);
  };

  // Start RAF loop
  rafId = requestAnimationFrame(rafLoop);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    unsubscribe();
    debouncedSync.cancel?.();
    console.log("[DEBUG] Pano→Forge sync cleaned up");
  };
}, []); // ← Empty array is OK here - mounts once

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  PUBLIC API – exposed to parent via ref                                  */
  /* ──────────────────────────────────────────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    jumpToIndex: (idx) => {
      if (idx < 0 || idx >= cameraPathRef.current.length) return;
      pathIndexRef.current = idx;
      updateCameraPosition();
      updatePathLine();
      updateCompassPositions();
      const p = cameraPathRef.current[idx];
      if (p.image_path) updatePanoramaTexture(p.image_path);
      notifyPanoIndex(idx);
    },
    getCurrentIndex: () => pathIndexRef.current,
    getPathPoints: () =>
      cameraPathRef.current.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  }));

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  STORE HELPERS                                                           */
  /* ──────────────────────────────────────────────────────────────────────── */
  const notifyPanoIndex = useCallback(
    (idx) => {
      setCurrentPanoIndex(idx);
      setPathPoints(
        cameraPathRef.current.map((p) => ({ x: p.x, y: p.y, z: p.z }))
      );
    },
    [setCurrentPanoIndex, setPathPoints]
  );

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  PANORAMA TEXTURE LOADING                                                */
  /* ──────────────────────────────────────────────────────────────────────── */
  const updatePanoramaTexture = useCallback((imagePath) => {
    console.log("text",!panoramaSphereRef.current || !imagePath)
    console.log("pano",{pano:panoramaSphereRef.current ,imagePath})
    if (!panoramaSphereRef.current || !imagePath) return;
    const img=`/data/set5/${imagePath}`
    const cached = textureCache.current.get(img);
    if (cached) {
      if (panoramaSphereRef.current.material.map)
        panoramaSphereRef.current.material.map.dispose();
      panoramaSphereRef.current.material.map = cached;
      panoramaSphereRef.current.material.needsUpdate = true;
      return;
    }

    textureLoader.current.load(
      img,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.encoding = THREE.sRGBEncoding;
        tex.minFilter = THREE.LinearFilter;
        tex.flipY=true
        // === FLIP HORIZONTALLY (left-right inversion) ===
        tex.center.set(0.5, 0.5);     // Set pivot to center
        tex.repeat.set(-1, 1);        // Scale X by -1 (flip horizontally)
        tex.needsUpdate = true;       // Important!
            textureCache.current.set(img, tex);
        if (panoramaSphereRef.current) {
          if (panoramaSphereRef.current.material.map)
            panoramaSphereRef.current.material.map.dispose();
          panoramaSphereRef.current.material.map = tex;
          panoramaSphereRef.current.material.needsUpdate = true;
        }
      },
      undefined,
      (err) => console.error("[PANO] Texture load failed:", img, err)
    );
  }, []);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CAMERA ORIENTATION                                                      */
  /* ──────────────────────────────────────────────────────────────────────── */
  const applySavedOrientation = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    // if (controlSource !== "user") return;

    const yaw = currentPOVRef.current.yaw;
    const pitch = currentPOVRef.current.pitch;

    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    const target = cam.position.clone().add(dir.clone().multiplyScalar(10));
    cam.lookAt(target);
  }, []);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CAMERA POSITION UPDATES                                                 */
  /* ──────────────────────────────────────────────────────────────────────── */
  const updateCameraPosition = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam || cameraPathRef.current.length === 0) return;

    const i = pathIndexRef.current;
    const p = cameraPathRef.current[i];
    const off = camOffsetRef.current;

    cam.position.set(p.x + off.x, p.y + 1.6 + off.y, p.z + off.z);
    applySavedOrientation();
    
  }, [applySavedOrientation]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  PATH LINE VISUALIZATION                                                 */
  /* ──────────────────────────────────────────────────────────────────────── */
  const updatePathLine = useCallback(() => {
    if (!pathLineRef.current || cameraPathRef.current.length === 0) return;

    const cur = pathIndexRef.current;
    const start = Math.max(0, cur - LOOK_AHEAD_BEHIND);
    const end = Math.min(cameraPathRef.current.length - 1, cur + LOOK_AHEAD_BEHIND);
    const visible = cameraPathRef.current.slice(start, end + 1);

    const pos = new Float32Array(visible.length * 3);
    visible.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    });

    if (pathLineRef.current.geometry) {
      pathLineRef.current.geometry.dispose();
    }
    pathLineRef.current.geometry = new THREE.BufferGeometry();
    pathLineRef.current.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(pos, 3)
    );
  }, []);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  COMPASS UPDATES                                                         */
  /* ──────────────────────────────────────────────────────────────────────── */

  // Updated updateCompassPOV to handle red/yellow wedge colors
const updateCompassPOV = useCallback(() => {
  if (!compassGroupRef.current || !cameraRef.current) return;

  const { wedgeAngle, yawY } = getFacingAnglesFromCamera(cameraRef.current);
  compassGroupRef.current.traverse((obj) => {
    if (obj.userData?.isCompass) {
      obj.userData.lastAngle = wedgeAngle;
      const isBackward = obj.userData.isBackward || false;
      obj.userData.draw(wedgeAngle, isBackward);
      obj.userData.texture.needsUpdate = true;
    }
    if (obj.userData?.isWalkman) {
      obj.rotation.y = obj.name.includes("back") ? yawY + Math.PI : yawY;
    }
  });
}, []);
 const updateCompassPositions = useCallback(() => {
  if (!compassGroupRef.current || cameraPathRef.current.length === 0) return;

  const i = pathIndexRef.current;
  const aheadIdx = Math.min(i + COMPASS_DISTANCE, cameraPathRef.current.length - 1);
  const backIdx = Math.max(i - COMPASS_DISTANCE, 0);

  const ahead = cameraPathRef.current[aheadIdx];
  const back = cameraPathRef.current[backIdx];

  const createGroup = (name, point, isBackward = false) => {
    const g = new THREE.Group();
    g.name = name;
    const circle = createCompassCircleXZ(COMPASS_RADIUS, { isBackward });
    circle.name = name.replace("group", "circle");
    circle.userData.isBackward = isBackward;
    g.add(circle);
    const walkman = buildWalkman(WALKMAN_SCALE);
    walkman.position.y = COMPASS_RADIUS * 0.06 + WALKMAN_LIFT;
    walkman.name = name.replace("group", "walkman");
    g.add(walkman);
    compassGroupRef.current.add(g);
    g.position.set(point.x, 0, point.z);
    return g;
  };

  let aheadGroup = compassGroupRef.current.getObjectByName("pano-compass-on-line-ahead");
  let backGroup = compassGroupRef.current.getObjectByName("pano-compass-on-line-back");

  if (!aheadGroup) {
    aheadGroup = createGroup("pano-compass-on-line-ahead", ahead, false);
  } else {
    aheadGroup.position.set(ahead.x, 0, ahead.z);
  }

  if (!backGroup) {
    backGroup = createGroup("pano-compass-on-line-back", back, true);
  } else {
    backGroup.position.set(back.x, 0, back.z);
  }

  updateCompassPOV();
}, [updateCompassPOV]);



// REPLACE WITH:
useEffect(() => {
  if (!cameraPathRef.current.length || pathIndexRef.current == null) return;

  const point = cameraPathRef.current[pathIndexRef.current];
  console.log("'image",point)
  if (point?.image_path) {
    updatePanoramaTexture(point.image_path);
  }
}, [pathIndexRef.current, updatePanoramaTexture]);


  /* ──────────────────────────────────────────────────────────────────────── */
  /*  NAVIGATION                                                              */
  /* ──────────────────────────────────────────────────────────────────────── */
  const move = useCallback(
    (delta) => {
      const newIdx = Math.max(
        0,
        Math.min(pathIndexRef.current + delta, cameraPathRef.current.length - 1)
      );

      if (newIdx === pathIndexRef.current) return;

      pathIndexRef.current = newIdx;
      const panoPt = cameraPathRef.current[newIdx];
      const newPoint = dataRef.current[newIdx];
      const quat=panoCam.pos.quat || panoCam.quat;
      console.log("panoCam",panoCam )
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(
      currentPOVRef.current.pitch,
      currentPOVRef.current.yaw,
      0,
      "YXZ"
    ));
      setPanoCam([  newPoint.x, newPoint.y, newPoint.z ],[q.x, q.y, q.z, q.w]);
      updateControlSource("user"); // Mark as user-initiated

      updateCameraPosition();
      updatePathLine();
      updateCompassPositions();
      if (panoPt.image_path) updatePanoramaTexture(panoPt.image_path);
      notifyPanoIndex(newIdx);
    },
    [
      updateCameraPosition,
      updatePathLine,
      updateCompassPositions,
      updatePanoramaTexture,
      notifyPanoIndex,
      updateControlSource,
    ]
  );

  const moveForward = useCallback(() => move(1), [move]);
  const moveBackward = useCallback(() => move(-1), [move]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  SCENE INITIALIZATION                                                    */
  /* ──────────────────────────────────────────────────────────────────────── */
  const initScene = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const sphereGeo = new THREE.SphereGeometry(500, 64, 64);
    const sphereMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);
    panoramaSphereRef.current = sphere;

    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x00ffff,
        linewidth: 8,
        transparent: true,
        opacity: 0.9,
      })
    );
    scene.add(line);
    pathLineRef.current = line;

    const compassGroup = new THREE.Group();
    compassGroup.name = "compass-group";
    scene.add(compassGroup);
    compassGroupRef.current = compassGroup;

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      updateCompassPOV();
      renderer.render(scene, camera);
    };
    animate();
  }, [updateCompassPOV]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  SCENE CLEANUP                                                           */
  /* ──────────────────────────────────────────────────────────────────────── */
  const cleanupScene = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    textureCache.current.forEach((t) => t.dispose());
    textureCache.current.clear();

    if (rendererRef.current) {
      rendererRef.current.forceContextLoss();
      rendererRef.current.domElement.remove();
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

    if (pathLineRef.current?.geometry) pathLineRef.current.geometry.dispose();
    if (pathLineRef.current?.material) pathLineRef.current.material.dispose();
  }, []);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  WINDOW RESIZE                                                           */
  /* ──────────────────────────────────────────────────────────────────────── */
  const onWindowResize = useCallback(() => {
    const m = mountRef.current;
    if (!m || !rendererRef.current || !cameraRef.current) return;

    const w = m.clientWidth;
    const h = m.clientHeight;
    rendererRef.current.setSize(w, h);
    cameraRef.current.aspect = w / h;
    cameraRef.current.updateProjectionMatrix();
  }, []);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  PATH FILTERING & PROCESSING                                             */
  /* ──────────────────────────────────────────────────────────────────────── */
  const rebuildPaths = useCallback(() => {
    const raw = dataRef.current;
    if (!raw.length) return;

    const sg = savitzkyGolay(raw, Math.max(3, windowSize), polyOrder);
    const kf = new KalmanFilter3D(processNoise, measurementNoise);
    const filtered = sg
        .map((p) => kf.update(p))
        .map((f, i) => ({
          x: -f.z,      // ← +Z (pano forward) → +X (Forge forward)
          y: PATH_HEIGHT,
          z: -f.x,     // ← +X (pano right) → +Z (Forge right)
          image_path: raw[i]?.image_path || null,
        }));

    const scaled = filtered.map((p) => ({
      ...p,
      z: p.z * Z_SCALE,
      yaw: 0,
      pitch: 0,
    }));

    // Pass image_path into fixOverlappingPoints (or modify it to preserve it)
    const fixed = fixOverlappingPoints(scaled, 0.05).map((point, i) => {
      // Find the closest original point to preserve image_path
      const original = scaled[i] || scaled[Math.min(i, scaled.length - 1)];
      return {
        ...point,
        image_path: original.image_path || null,
      };
});
    console.log("rebuild",fixed);
    cameraPathRef.current = fixed;
    pathIndexRef.current = Math.min(pathIndexRef.current, fixed.length - 1);

    fixed.forEach((p, i) => {
      if (p.yaw === 0 && p.pitch === 0 && fixed[i + 1]) {
        const dx = fixed[i + 1].x - p.x;
        const dz = fixed[i + 1].z - p.z;
        p.yaw = Math.atan2(dz, dx);
      }
    });

    if (fixed.length) {
      const p = fixed[pathIndexRef.current];
      const off = camOffsetRef.current;
      cameraRef.current.position.set(p.x + off.x, p.y + 1.6 + off.y, p.z + off.z);
      applySavedOrientation();
      if (p.image_path) updatePanoramaTexture(p.image_path);
    }

    updatePathLine();
    updateCompassPositions();
    setPathPoints(fixed.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    notifyPanoIndex(pathIndexRef.current);
  }, [
    windowSize,
    polyOrder,
    processNoise,
    measurementNoise,
    updatePanoramaTexture,
    applySavedOrientation,
    updatePathLine,
    updateCompassPositions,
    setPathPoints,
    notifyPanoIndex,
  ]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  MOUSE & TOUCH CONTROLS                                                  */
  /* ──────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const onDown = (e) => {
  isUserDraggingRef.current = true;               // ← USER STARTED
  mouseStateRef.current.isDragging = true;
  mouseStateRef.current.prevX = e.clientX || e.touches?.[0]?.clientX;
  mouseStateRef.current.prevY = e.clientY || e.touches?.[0]?.clientY;
  updateControlSource("user");
};

const onMove = (e) => {
  const s = mouseStateRef.current;
  if (!s.isDragging) return;

  const x = e.clientX || e.touches?.[0]?.clientX;
  const y = e.clientY || e.touches?.[0]?.clientY;
  const dx = x - s.prevX;
  const dy = y - s.prevY;

  currentPOVRef.current.yaw   += dx * 0.005;
  currentPOVRef.current.pitch += dy * 0.005;
  currentPOVRef.current.pitch = Math.max(
    -Math.PI / 2 + 0.01,
    Math.min(Math.PI / 2 - 0.01, currentPOVRef.current.pitch)
  );

  applySavedOrientation();
  s.prevX = x;
  s.prevY = y;

  // ──────── ONLY PUSH WHEN USER IS DRAGGING ────────
  if (isUserDraggingRef.current) {
    updateControlSource("user");
    const cam = cameraRef.current;
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(
      currentPOVRef.current.pitch,
      currentPOVRef.current.yaw,
      0,
      "YXZ"
    ));

      const position=dataRef.current[pathIndexRef.current];
    console.log("data",dataRef.current)
    console.log("idx",position)
    // Use smoothSyncPano (smooth animation) instead of setPanoCam
    setPanoCam(
      [position.x, position.y, position.z],
      [q.x, q.y, q.z, q.w]
    );
  }
};

const onUp = () => {
  mouseStateRef.current.isDragging = false;
  isUserDraggingRef.current = false;              // ← USER STOPPED
};

    const onContextMenu = (e) => {
      e.preventDefault();
      if (!window.calib?.addPanoPoint) return;

      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
      const intersects = raycaster.intersectObject(panoramaSphereRef.current);

      if (intersects.length === 0) return;

      const pt = intersects[0].point;
      const pathPt = cameraPathRef.current[pathIndexRef.current];
      const worldPos = {
        x: pathPt.x + pt.x / 500,
        y: pathPt.y,
        z: pathPt.z + pt.z / 500,
      };

      window.calib.addPanoPoint(worldPos);
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mouseleave", onUp);
    el.addEventListener("touchstart", onDown);
    el.addEventListener("touchmove", onMove);
    el.addEventListener("touchend", onUp);
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("mouseleave", onUp);
      el.removeEventListener("touchstart", onDown);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onUp);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [applySavedOrientation, setPanoCam, updateControlSource]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  FORGE to PANO SYNC – position + orientation                             */
  /* ──────────────────────────────────────────────────────────────────────── */
useEffect(()=>{
 if (
    !cameraRef.current ||
    isSyncing ||
    !forgeCam ||
    !calibrationRef.current
  ) return;

    const token = Math.random();
  lastProgrammaticTokenPano.current = token;

  updateControlSource("sync");

  const calib = calibrationRef.current;
  const { pos, quat } = forgeCam;
  
  // ✅ Forge position in meters
  const forgePts = [pos[0], pos[1], pos[2]];
  console.log("forge",forgePts  )
  
  // ✅ Transform forge to pano using calibration
  const panoPt = forgeToPano(forgePts, calib);
  const panoPos = { x: panoPt[0], y: panoPt[1], z: panoPt[2] };

  console.log('[SYNC] Forge position:', forgePts);
  console.log('[SYNC] Pano position:', panoPos);

  const points = cameraPathRef.current;
  if (points.length === 0) return;

  // ✅ IMPROVED: Find closest point using 3D distance in pano space
  let closestIdx = 0;
  let minDist = Infinity;
  
  points.forEach((p, i) => {
    // Use all 3 dimensions (x, y, z) for better accuracy
    const dx = p.x - panoPos.x;
    const dy = p.y - panoPos.y;
    const dz = p.z - panoPos.z;
    
    // Euclidean distance in 3D
    const dist = dx * dx + dy * dy + dz * dz;
    
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  });

  const closestDistance = Math.sqrt(minDist);
  console.log('[SYNC] Closest point index:', closestIdx);
  console.log('[SYNC] Distance to closest:', closestDistance.toFixed(4), 'm');

  // ✅ Optional: warn if too far from any point
  if (closestDistance > 5.0) {
    console.warn(`⚠️ Pano position ${panoPos} is far from all path points (${closestDistance.toFixed(2)}m)`);
  }

  pathIndexRef.current = closestIdx;
  notifyPanoIndex(closestIdx);
  updateCameraPosition(); // ← Sets position + calls applySavedOrientation (but skipped due to controlSource)
  updatePathLine();
  updateCompassPositions();

  // ────── ROTATION ──────
  const [qx, qy, qz, qw] = quat;
   // 1. Mirror Forge → Pano
 const [tx, ty, tz, tw] = reverseTransform(qx, qy, qz, qw);
 const mirrored = new THREE.Quaternion(tx, ty, tz, tw);

 // 2. Apply the constant –90° yaw *first* (this rotates the whole
 //    reference frame so that +Z in Forge becomes +X in Pano)
 mirrored.multiply(YAW_MINUS_90);

 // 3. OPTIONAL: bring the quaternion back to a normalized state
 mirrored.normalize();

 const panoQuat = mirrored;

  cameraRef.current.quaternion.copy(panoQuat);

  // ← UPDATE POV REF (so user can resume dragging from correct angle)
  const euler = new THREE.Euler().setFromQuaternion(panoQuat, "YXZ");
  currentPOVRef.current.yaw = euler.y;
  currentPOVRef.current.pitch = euler.x;

  // ← DO NOT call applySavedOrientation() here

  const p = points[closestIdx];
  if (p.image_path) updatePanoramaTexture(p.image_path);

  const camOff = camOffsetRef.current;
  useSyncStore.getState().smoothSyncPano(
    [p.x + camOff.x, PATH_HEIGHT + camOff.y, p.z + camOff.z],
    [panoQuat.x, panoQuat.y, panoQuat.z, panoQuat.w]
  );


  setTimeout(() => {
  if (lastProgrammaticTokenPano.current === token) {
    lastProgrammaticTokenPano.current = null;
  }
}, 100);
},[forgeCam])

useEffect(()=>{
  console.log("forge",forgeCam)

},[forgeCam])



  /* ──────────────────────────────────────────────────────────────────────── */
  /*  DATA LOADING                                                            */
  /* ──────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;

    (async () => {
      let pts = [];

      try {
        const r = await fetch("/data/set5/dataset_360.json");
        if (r.ok) {
          const j = await r.json();
          pts = j.frames.map((d) => {
            const pos = d.position || d.pos || d.coordinates || d;
            const img = d.image_path || d.image || d.img || d.texture || null;
            return {
              x: pos.x ?? pos.X ?? pos[0] ?? 0,
              y: pos.y ?? pos.Y ?? pos[1] ?? 1.6,
              z: pos.z ?? pos.Z ?? pos[2] ?? 0,
              image_path: img,
            };
          });
        }
      } catch (e) {
        console.warn("[PANO] Failed to load turn_data.json:", e);
      }

      if (!pts.length) {
        const steps = 200;
        const seg = 20;
        const dirs = [
          { x: 1, z: 0 },
          { x: 0, z: 1 },
          { x: -1, z: 0 },
          { x: 0, z: -1 },
        ];
        let cx = 0, cz = 0, dir = 0;
        for (let i = 0; i < steps; i++) {
          const d = dirs[dir % 4];
          const len = 0.5 + ((i % seg) * 0.02);
          cx += d.x * len;
          cz += d.z * len;
          pts.push({
            x: cx + (Math.random() - 0.5) * 0.08,
            y: 1.6 + (Math.random() - 0.5) * 0.05,
            z: cz + (Math.random() - 0.5) * 0.08,
            image_path: null,
          });
          if ((i + 1) % seg === 0) dir++;
        }
      }

      if (alive) {
        dataRef.current = pts;
        initScene();
        rebuildPaths();
      }
    })();

    return () => {
      alive = false;
    };
  }, [initScene, rebuildPaths]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  REBUILD ON FILTER CHANGE                                                */
  /* ──────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (dataRef.current.length) rebuildPaths();
  }, [windowSize, polyOrder, processNoise, measurementNoise, rebuildPaths]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CLEANUP & RESIZE                                                        */
  /* ──────────────────────────────────────────────────────────────────────── */
  useEffect(() => cleanupScene, [cleanupScene]);
  useEffect(() => {
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [onWindowResize]);

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  RENDER                                                                  */
  /* ──────────────────────────────────────────────────────────────────────── */
  const getControlSourceColor = () => {
    switch (controlSource) {
      case "user":
        return "#00ff00"; // Green for user
      case "sync":
        return "#ff6600"; // Orange for sync
      default:
        return "#888888"; // Gray for idle
    }
  };

  const getControlSourceLabel = () => {
    switch (controlSource) {
      case "user":
        return "👤 USER CONTROL";
      case "sync":
        return "🔄 SYNC CONTROL";
      default:
        return "⏸ IDLE";
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />

      <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 12, zIndex: 10 }}>
        <button onClick={moveBackward} style={btnStyle("#1d4ed8")}>Back</button>
        <button onClick={moveForward} style={btnStyle("#dc2626")}>Forward</button>
      </div>

      <div style={{
        position: "absolute", top: 20, left: 20, background: "rgba(0,0,0,0.7)", color: "#0f0",
        padding: 12, borderRadius: 6, fontFamily: "monospace", fontSize: 12, maxWidth: 300, zIndex: 10
      }}>
        <div>Path Index: {pathIndexRef.current}</div>
        <div>Total Points: {cameraPathRef.current.length}</div>
        <div>Yaw: {currentPOVRef.current.yaw.toFixed(3)} | Pitch: {currentPOVRef.current.pitch.toFixed(3)}</div>
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
          Drag to look | Forward/Back to move
        </div>
        <div style={{ marginTop: 5, fontSize: 11, opacity: 0.7 }}>
          Right-click: Add calibration point
        </div>
      </div>

      {/* Control Source Indicator */}
      <div style={{
        position: "absolute",
        top: 20,
        right: 20,
        background: "rgba(0,0,0,0.8)",
        border: `2px solid ${getControlSourceColor()}`,
        color: getControlSourceColor(),
        padding: "12px 16px",
        borderRadius: 8,
        fontFamily: "monospace",
        fontSize: 13,
        fontWeight: "bold",
        zIndex: 10,
        boxShadow: `0 0 12px ${getControlSourceColor()}40`,
        transition: "all 0.2s ease",
        textAlign: "center",
      }}>
        {getControlSourceLabel()}
        <div style={{
          fontSize: 10,
          opacity: 0.7,
          marginTop: 4,
          letterSpacing: "1px",
        }}>
          {controlSource === "user" && "← You're controlling"}
          {controlSource === "sync" && "← Syncing from Forge"}
          {controlSource === "idle" && "← Waiting for input"}
        </div>
      </div>
    </div>
  );
});

PathCameraExplorer.displayName = "PathCameraExplorer";
export default PathCameraExplorer;

/* BUTTON STYLE */
const btnStyle = (bg) => ({
  padding: "12px 24px",
  background: bg,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontWeight: "bold",
  fontSize: 14,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  transition: "all 0.2s ease",
  opacity: 0.9,
  backdropFilter: "blur(6px)",
});