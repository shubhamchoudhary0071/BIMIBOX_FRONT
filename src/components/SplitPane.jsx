/* SplitPane.jsx – FULL FILE */
import React, { useRef, useEffect, useState } from "react";
import PathCameraExplorer from "./PathCameraExplorer";
import { calculateCalibration } from "../utils/calibratePanoToForge";
import ForgeViewer from './ForgeViewer'
import { useSyncStore } from "../store/syncStore";
const STORAGE_KEY = "revit-pano-calibration-v2";

export default function SplitPane() {
  const panoRef = useRef(null);
  const urn =import.meta.env.VITE_APS_URN

  const { setCalibration } = useSyncStore();

  const [showCalib, setShowCalib] = useState(false);

  // Always start with 3 empty pairs
  const [pointPairs, setPointPairs] = useState([
    { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
    { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
    { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
  ]);

  /* ------------------------------------------------------------------ */
  /*  LOAD SAVED CALIBRATION                                            */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.length < 3) throw new Error("Need >=3 pairs");

      const isValid = parsed.every(pair =>
        ["revit", "pano"].every(space =>
          ["x", "y", "z"].every(coord => !isNaN(parseFloat(pair[space][coord])))
        )
      );
      if (!isValid) throw new Error("Invalid numbers");

      setPointPairs(parsed);
      applyCalibration(parsed);
      console.log("[CALIB] Loaded from localStorage");
    } catch (e) {
      console.warn("[CALIB] Load failed → clearing", e);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /*  APPLY CALIBRATION (uses calculateCalibration)                     */
  /* ------------------------------------------------------------------ */
  const applyCalibration = (pairs) => {
    try {
      const revitPoints = pairs.map(p => [
        parseFloat(p.revit.x),
        parseFloat(p.revit.y),
        parseFloat(p.revit.z),
      ]);
      const panoPoints = pairs.map(p => [
        parseFloat(p.pano.x),
        parseFloat(p.pano.y),
        parseFloat(p.pano.z),
      ]);

      const calibration = calculateCalibration(panoPoints, revitPoints);
      setCalibration(calibration);
      console.log("[CALIB] Applied:", calibration);
    } catch (err) {
      console.error("[CALIB] Compute error:", err);
      alert("Calibration failed: " + err.message);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  SAVE TO localStorage                                              */
  /* ------------------------------------------------------------------ */
  const saveCalibration = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pointPairs));
    console.log("[CALIB] Saved to localStorage");
  };

  /* ------------------------------------------------------------------ */
  /*  HANDLE APPLY BUTTON                                               */
  /* ------------------------------------------------------------------ */
  const handleApply = () => {
    const valid = pointPairs.filter(pair =>
      ["revit", "pano"].every(space =>
        ["x", "y", "z"].every(coord =>
          pair[space][coord] !== "" && !isNaN(parseFloat(pair[space][coord]))
        )
      )
    );

    if (valid.length < 3) {
      alert("Please fill **all three** initial point pairs (X/Y/Z) before applying.");
      return;
    }

    // keep only the valid ones (user may have left some later rows empty)
    setPointPairs(valid.map(p => ({
      revit: { x: p.revit.x, y: p.revit.y, z: p.revit.z },
      pano: { x: p.pano.x, y: p.pano.y, z: p.pano.z },
    })));

    applyCalibration(valid);
    saveCalibration();
    setShowCalib(false);
    alert(`Calibration applied with ${valid.length} point pair${valid.length > 1 ? "s" : ""}!`);
  };

  /* ------------------------------------------------------------------ */
  /*  RESET                                                             */
  /* ------------------------------------------------------------------ */
  const resetCalibration = () => {
    if (!confirm("Delete saved calibration and reset all points?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setCalibration(null);
    setPointPairs([
      { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
      { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
      { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
    ]);
    alert("Calibration reset");
  };

  /* ------------------------------------------------------------------ */
  /*  ADD / REMOVE POINT PAIRS                                          */
  /* ------------------------------------------------------------------ */
  const addPointPair = () => {
    setPointPairs([
      ...pointPairs,
      { revit: { x: "", y: "", z: "" }, pano: { x: "", y: "", z: "" } },
    ]);
  };

  const removePointPair = (idx) => {
    if (pointPairs.length <= 3) {
      alert("You must keep at least 3 point pairs.");
      return;
    }
    setPointPairs(pointPairs.filter((_, i) => i !== idx));
  };

  const updatePoint = (idx, space, coord, value) => {
    const copy = [...pointPairs];
    copy[idx] = {
      ...copy[idx],
      [space]: { ...copy[idx][space], [coord]: value },
    };
    setPointPairs(copy);
  };

  /* ------------------------------------------------------------------ */
  /*  UI HELPERS                                                        */
  /* ------------------------------------------------------------------ */
  const allThreeFilled = pointPairs
    .slice(0, 3)
    .every(pair =>
      ["revit", "pano"].every(space =>
        ["x", "y", "z"].every(coord => pair[space][coord] !== "" && !isNaN(parseFloat(pair[space][coord])))
      )
    );

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative", flexDirection: "column" }}>
      {/* Top-right buttons */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 8 }}>
        <button onClick={() => setShowCalib(true)} style={btnStyle("#10b981")}>Calibrate</button>
        <button onClick={resetCalibration} style={btnStyle("#dc2626")}>Reset</button>
      </div>

      {/* Calibration modal */}
      {showCalib && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h2>Manual Calibration</h2>
            <p>
              Enter **at least three** corresponding points (Revit to Panorama). <br />
              Fill the first three rows completely, then you may add more.
            </p>

            <div style={{ maxHeight: "58vh", overflowY: "auto", marginBottom: 16 }}>
              {pointPairs.map((pair, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: 16,
                    marginBottom: 12,
                    alignItems: "center",
                    opacity: idx < 3 ? 1 : 0.95,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Revit Point {idx + 1}</label>
                    <PointInput
                      point={pair.revit}
                      onChange={(c, v) => updatePoint(idx, "revit", c, v)}
                    />
                  </div>

                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Pano Point {idx + 1}</label>
                    <PointInput
                      point={pair.pano}
                      onChange={(c, v) => updatePoint(idx, "pano", c, v)}
                    />
                  </div>

                  {pointPairs.length > 3 && (
                    <button
                      onClick={() => removePointPair(idx)}
                      style={btnStyle("#ef4444", 34)}
                      title="Remove"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add button – visible only after the first 3 are filled */}
            {allThreeFilled && (
              <div style={{ marginBottom: 16 }}>
                <button onClick={addPointPair} style={btnStyle("#3b82f6")}>
                  + Add another point pair
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCalib(false)} style={btnStyle("#6b7280")}>
                Cancel
              </button>
              <button onClick={handleApply} style={btnStyle("#10b981")}>
                Apply & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewers */}
      <div style={{ flex: 1, display: "flex" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <PathCameraExplorer ref={panoRef} />
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <ForgeViewer urn={urn} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Re-usable Point Input                                             */
/* ------------------------------------------------------------------ */
const PointInput = ({ point, onChange }) => (
  <div style={{ display: "flex", gap: 6 }}>
    {["x", "y", "z"].map(coord => (
      <input
        key={coord}
        placeholder={coord.toUpperCase()}
        value={point[coord]}
        onChange={e => onChange(coord, e.target.value)}
        style={inputStyle}
      />
    ))}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */
const inputStyle = {
  width: 70,
  padding: 6,
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 13,
};

const labelStyle = { fontSize: 12, color: "#555", display: "block", marginBottom: 4 };

const btnStyle = (bg, height = 40) => ({
  padding: "8px 12px",
  background: bg,
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: "bold",
  height,
  minWidth: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

const modalOverlay = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const modalContent = {
  background: "white",
  padding: 24,
  borderRadius: 12,
  width: 740,
  maxHeight: "90vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};