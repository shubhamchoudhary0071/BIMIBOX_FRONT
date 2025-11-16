# 🏗️ Forge + Panorama + FloorMap Sync System

### **Full Combined README + Developer Guide + Architecture Reference (Complete Edition)**

------------------------------------------------------------------------

# 📌 1. Overview

This project integrates:

-   **Autodesk Forge Viewer** (3D BIM model)
-   **Three.js Panorama Viewer** (PathCameraExplorer)
-   **FloorMap** (interactive 2D SVG floorplan with camera alignment)

All systems are synchronized through a global controller:\
👉 **Zustand Sync Store (`syncStore.js`)**

You can click on the floor plan, move inside the panorama, or orbit
around Forge ---\
➡️ The camera will move & sync in all other components smoothly.

This README includes:

✔ Getting Started\
✔ Installation\
✔ Architecture diagrams\
✔ Component breakdown\
✔ Calibration workflow\
✔ Sync system internals\
✔ FloorMap internal logic\
✔ Developer lifecycle\
✔ Units & metrics\
✔ Dataset rules\
✔ Full system diagrams\
✔ Troubleshooting\
✔ Best practices

------------------------------------------------------------------------

# 📌 2. Getting Started

## 2.1 Prerequisites

Install:

-   Node.js (v18+ recommended)
-   npm (comes with Node)

------------------------------------------------------------------------

## 2.2 Installation

``` bash
git clone <your-repo-url>
cd <project-folder>

npm install
npm run dev
```

The dev server runs at:

    http://localhost:3000

------------------------------------------------------------------------

# 📌 3. Standard Units --- IMPORTANT

> ⚠ ALL coordinates, calibration points, pano dataset values, Forge
> model values **must be in meters**.

The entire system assumes the world uses **metric** units.

-   Dataset positions → meters\
-   Calibration → meters\
-   Forge viewer coordinates → meters\
-   FloorMap returned coordinates → meters

Ensure any imported CAD / BIM / dataset values are converted before use.

------------------------------------------------------------------------

# 📌 4. Project Structure

    src/
      components/
        ForgeViewer.jsx
        PathCameraExplorer.jsx
        FloorMap.jsx
        SplitPane.jsx

      store/
        syncStore.js

      utils/
        calibratePanoToForge.js
        camera_transformation.js

      lib/
        pano_helpers.js
        floor_map_helpers.js
        forge_helpers.js

    public/
      data/
        set1/
        set2/
        set3/
        set4/
        set5/
        set6/

------------------------------------------------------------------------

# 📌 5. Component Guide

------------------------------------------------------------------------

# 5.1 ForgeViewer.jsx

### Responsibilities

-   Initialize Autodesk Forge Viewer
-   Load models using URN
-   Mirror synced camera updates
-   Apply coordinate transformation matrix
-   Update global camera state (forgeCam + forgePosition)

### Sync behavior

Forge viewer sends camera updates to syncStore using:

``` js
setForgeCam(pos, quat, { noAnimate: true })
```

This prevents accidental animation loops.

------------------------------------------------------------------------

# 5.2 PathCameraExplorer.jsx (Panorama Viewer)

### Responsibilities

-   Load 360° dataset
-   Display panoramic textures
-   Move along path via dataset JSON
-   Sync camera updates into store
-   React to floor clicks
-   Provide forward direction for FloorMap

### IMPORTANT

The dataset appears in **two places**:

1.  Initial data load\
2.  Texture update function

Update both when switching dataset:

``` js
/data/set5/dataset_360.json
```

------------------------------------------------------------------------

# 5.3 FloorMap.jsx (2D Floor Plan)

### Responsibilities

-   Render interactive SVG floor plan\
-   Display model boundaries\
-   Display pano path\
-   Display camera marker & direction wedge\
-   Convert floor clicks → pano 3D positions\
-   Provide calibration UI\
-   Map Pano → Forge space through matrix

### Key Features

✔ Pan + Zoom (mouse wheel, drag)\
✔ Hover coordinates in meters\
✔ Camera marker projected on path\
✔ Custom overlay tools\
✔ Calibration workflow\
✔ Path following

------------------------------------------------------------------------

# 📌 6. Sync System Architecture

The entire synchronization is orchestrated through:

## 🧠 syncStore.js (Zustand)

### Purpose

-   Maintain unified state between Forge, Pano, FloorMap
-   Track the most recent update source
-   Prevent infinite loops
-   Interpolate animations (smooth sync)
-   Store calibration and floor clicks

------------------------------------------------------------------------

### Data Flow Diagram

               (Pano Movement)
    PathCameraExplorer  ─────►  syncStore  ─────► ForgeViewer
                             ▲          │
                             │          ▼
                     FloorMap ◄──── floorClick

------------------------------------------------------------------------

### Store Contains:

  State                      Description
  -------------------------- ------------------------------------------------
  panoCam                    {pos, quat} from panorama viewer
  forgeCam                   {pos, quat} from Forge viewer
  floorPosition              Last clicked floor coordinate (meters)
  source                     "pano" or "forge" --- identifies update origin
  isSyncing                  Set when syncing starts
  syncCount                  Debugging counter
  floorClick                 `{pos, seq}` used to trigger pano jumps
  smooth animation targets   targetPanoPose, targetForgePose

## Smooth interpolation

Uses **lerp() + slerp()** for smooth transitions over 300ms.

------------------------------------------------------------------------

# 📌 7. Calibration Guide

Calibration solves the mapping:

    SVG coordinates → Model coordinates (meters)

You choose 3 points:

1.  Click on map\
2.  Enter model coordinates (meters)\
3.  Press Apply

Behind the scenes it builds:

    [a b c]
    [d e f]

Used in:

``` js
mapSvgToModel()
mapModelToSvg()
panoToForge()
```

The computed matrix is saved in:

    localStorage["revit-pano-calibration-v2"]

------------------------------------------------------------------------

# 📌 8. FloorMap Internals

## 8.1 Zoom + Pan

-   Wheel zoom adjusts viewBox
-   Drag pans the viewBox
-   Clamp logic ensures map boundaries stay visible

## 8.2 Path Projection Algorithm

Ensures the camera marker snaps to the closest point on the path
forward:

``` js
projectToSegment(px, py, a, b)
```

Used inside:

``` js
setDotPositionOnPath()
```

## 8.3 Camera Heading

Using quaternion → 2D direction:

``` js
rotateVecByQuat()
```

------------------------------------------------------------------------

# 📌 9. Dataset Format

Example entry:

``` json
{
  "position": {"x": 0, "y": 1.6, "z": 0},
  "image_path": "frame_0001.jpg"
}
```

Dataset loading: - Smooths via **Savitzky--Golay** - Converts vectors to
metric system - Generates path for FloorMap

------------------------------------------------------------------------

# 📌 10. System Diagrams

## Full Overview

                    FloorMap (2D SVG)
                     ▲       │
                     │       ▼
               ┌──── syncStore ────┐
               │                    │
               ▼                    ▼
      PathCameraExplorer       ForgeViewer
        (Three.js)               (APS)

## Sync Loop Prevention

    Forge update ---> source="forge"
    Pano ignores forge-origin updates

    Pano update ----> source="pano"
    Forge ignores pano-origin updates

------------------------------------------------------------------------

# 📌 11. Troubleshooting

### ❌ Camera not syncing

Check: - Calibration matrix loaded? - syncStore source flags?

### ❌ Floor click not moving panorama

Ensure: - `floorClick.seq` increments\
- Path index computed correctly\
- Dataset smoothed properly

### ❌ Map looks unscaled

Reset calibration:\
UI → Reset Calibration

------------------------------------------------------------------------

# 📌 12. Best Practices

✔ Always input coordinates in **meters**\
✔ Disable animation for internal camera updates\
✔ Use `source` to prevent camera loops\
✔ Keep dataset smoothed\
✔ Refresh calibration when switching floors\
✔ Avoid rapid-fire updates by using debounce/throttle

------------------------------------------------------------------------

# 📌 13. Environment Setup

`.env` file:

    VITE_APS_CLIENT_ID=
    VITE_APS_CLIENT_SECRET=
    VITE_APS_URN=

------------------------------------------------------------------------

# 📌 14. Commands

  Command             Use
  ------------------- --------------------------
  `npm install`       Install dependencies
  `npm run dev`       Start development
  `npm run build`     Production build
  `npm run preview`   Serve production locally

------------------------------------------------------------------------

# 🎉 Complete README Generated

This README includes **everything**:

-   Installation\
-   Architecture\
-   Developer guide\
-   FloorMap internals\
-   SyncStore logic\
-   Calibration guide\
-   System diagrams\
-   Dataset rules\
-   Units\
-   Complete workflow