# 🏗️ Forge + PathCameraExplorer Vite App

A Vite-based web application integrating **Autodesk Forge Viewer** with a **Three.js Panorama Explorer**, enabling real-time camera synchronization, calibration, and 3D navigation visualization.

---

## 🚀 Getting Started

### 1️⃣ Prerequisites
Make sure you have the following installed:
- [Node.js](https://nodejs.org/en/download/) (v18+ recommended)
- npm (comes with Node.js)

---

### 2️⃣ Installation Steps

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd <your-project-folder>
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the development server**
   ```bash
   npm run dev
   ```

4. Open your browser and visit:
   ```
   http://localhost:3000
   ```

> ⚙️ The app runs on **port 3000** by default.  
> If another process is using the port, Vite will prompt you to choose another.

---

## 📏 **Standard Units — IMPORTANT**

> ⚠️ **This application uses *METERS* as the standard unit for all spatial calculations and coordinate inputs.**

- All **positions, coordinates, and calibration values** must be entered in **meters**.
- The calibration process and all 3D coordinate transformations (Forge ↔ Panorama) are based on **metric units**.
- Ensure your dataset and any manual coordinate entries are **converted to meters** before use.

---

## 🧭 Directory Overview

```
.
├── .env
├── index.html
├── package.json
├── vite.config.js
├── src
│   ├── components
│   │   ├── ForgeViewer.jsx
│   │   ├── PathCameraExplorer.jsx
│   │   └── SplitPane.jsx
│   ├── lib
│   │   ├── api.js
│   │   ├── forge_helpers.js
│   │   ├── pano_helpers.js
│   │   └── textures.js
│   ├── store
│   │   └── syncStore.js
│   ├── utils
│   │   ├── calibratePanoToForge.js
│   │   └── camera_transformation.js
│   └── main.jsx
└── public
    └── data
        ├── set1
        ├── set2
        ├── set3
        ├── set4
        ├── set5
        └── set6
```

---

## 🧩 Main Components

### 🏗️ `ForgeViewer.jsx`
- Handles **Autodesk Forge Viewer** initialization and model loading.
- Manages **camera synchronization** with the Three.js panorama viewer (`PathCameraExplorer`).
- Applies calibration transformations between **Forge coordinates** and **panorama coordinates**.

---

### 🌀 `PathCameraExplorer.jsx`
- Implements the **Three.js panorama viewer**.
- Loads 360° image textures and reconstructs user movement paths.
- Responsible for syncing **panorama camera movement** with **Forge Viewer**.
- Reads the dataset JSON (path and frames) to visualize camera trajectory.

> 🔁 The dataset path is hardcoded in **two places** in this file:
> 1. Inside the `init` useEffect  
> 2. Inside the `updatePanoramaTexture` function  
>  
> If you’re using a new dataset, update both references to point to your new dataset file:
> ```js
> /public/data/<your-set-name>/dataset_360.json
> ```
>  
> **Example (current default):**
> ```js
> /data/set5/dataset_360.json
> ```

---

### 🧱 `SplitPane.jsx`
- Acts as the **parent container** of both `ForgeViewer` and `PathCameraExplorer`.
- Handles **UI layout** and **resizable split panes** between the two viewers.
- Also manages the **calibration setup** between Forge and panorama coordinate systems.

---

## 🛠️ Supporting Modules

### `helpers/pano_helpers.js`
- Contains utility functions for panorama rendering, texture management, and math helpers.

### `utils/`
- `calibratePanoToForge.js`: Handles calibration matrix computation and 3D coordinate conversion.
- `camera_transformation.js`: Handles quaternion and matrix transformations between camera coordinate spaces.

### `store/syncStore.js`
- Global state store (using Zustand) for managing sync data between viewers.

---

## 🧠 Calibration Reminder

- Calibration links the Forge world coordinates and panorama camera coordinates.
- Always ensure **both calibration inputs** (Forge & Panorama points) are in **meters**.
- The calibration data is saved locally (`localStorage`) under the key:
  ```
  revit-pano-calibration-v2
  ```

---

## 🧩 Common Commands

| Command | Description |
|----------|-------------|
| `npm install` | Install all dependencies |
| `npm run dev` | Start Vite dev server on port 3000 |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |

---

## 🧰 Environment Configuration

You can store your Autodesk Forge credentials in a `.env` file (if applicable):

```
FORGE_CLIENT_ID=your_client_id
FORGE_CLIENT_SECRET=your_client_secret
```

---

## 📚 Notes

- Make sure to have the **Forge model URN** configured in your `ForgeViewer` component.
- The app expects the Forge token endpoint to be set up in `/lib/api.js`.
- If calibration data is missing, the Forge viewer will log a warning.

---

## 🧭 Summary

✅ Runs on **Vite (port 3000)**  
✅ Uses **meters** as the standard unit across all systems  
✅ Syncs **Autodesk Forge Viewer** and **Three.js Panorama**  
✅ Calibration and coordinate inputs **must be in meters**  
✅ Update dataset paths in `PathCameraExplorer.jsx` when switching data sets

---

**Developed with ❤️ for precise Forge–Panorama synchronization**
