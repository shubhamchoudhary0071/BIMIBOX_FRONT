import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Panoramic Sphere Viewer - Three.js Implementation
 * Maps panoramic positions with visible path and orbit controls
 */
export class PanoramicSphereViewer {
  constructor(containerElement, cameraHeight = 2.5) {
    this.container = containerElement;
    this.cameraHeight = cameraHeight;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.orbitControls = null;
    this.turnData = null;
    this.currentFrameIndex = 0;
    this.isAutoPlay = false;
    this.animationSpeed = 100;

    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.setupScene();
  }

  setupScene() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.Fog(0x000000, 1000, 5000);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.width / this.height,
      0.1,
      10000
    );
    this.camera.position.set(20, 15, 20);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.far = 200;
    this.scene.add(directionalLight);

    // Orbit Controls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.enableZoom = true;
    this.orbitControls.autoRotate = false;
    this.orbitControls.enablePan = true;
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();

    // Grid Helper
    const gridHelper = new THREE.GridHelper(100, 20, 0x444444, 0x888888);
    this.scene.add(gridHelper);

    // Axes Helper
    const axesHelper = new THREE.AxesHelper(30);
    this.scene.add(axesHelper);

    // Handle resize (bound properly)
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  /**
   * Create panoramic sphere with texture (or wireframe placeholder if no image)
   */
  createPanoramicSphere(imagePath) {
    const existingSphere = this.scene.getObjectByName('panoramaSphericalSphere');
    if (existingSphere) {
      existingSphere.geometry?.dispose();
      existingSphere.material?.dispose();
      this.scene.remove(existingSphere);
    }

    if (!imagePath) {
      // Placeholder: wireframe sphere for debugging
      const geometry = new THREE.SphereGeometry(500, 64, 64);
      const material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        side: THREE.BackSide
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.name = 'panoramaSphericalSphere';
      this.scene.add(sphere);
      console.log('✓ Wireframe panoramic sphere created (no image provided)');
      return;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      imagePath,
      (texture) => {
        const geometry = new THREE.SphereGeometry(500, 64, 64);
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = 'panoramaSphericalSphere';
        this.scene.add(sphere);
        console.log('✓ Panoramic sphere loaded');
      },
      undefined, // onProgress (optional)
      (error) => {
        console.error('Failed to load panoramic texture:', error);
        // Fallback to wireframe
        this.createPanoramicSphere(null);
      }
    );
  }

  /**
   * Load turn data and optionally create full-path visualization (overview mode)
   */
  loadTurnData(turnData, visualizeFullPath = false) {
    this.turnData = turnData;

    if (visualizeFullPath) {
      this.createPathVisualization();
    }

    console.log('\n' + '='.repeat(50));
    console.log('✓ PATH DATA LOADED');
    console.log('='.repeat(50));
    console.log('Total waypoints:', turnData.length);
    console.log('Full path viz:', visualizeFullPath ? 'enabled (overview)' : 'disabled (first-person)');
    console.log('Controls: Orbit with mouse, scroll to zoom');
    console.log('='.repeat(50) + '\n');
  }

  /**
   * Create full path visualization (overview: line + waypoints + arrows)
   */
  createPathVisualization() {
    // ... (unchanged from original: removes existing, creates curve line, waypoints, arrows)
    const existingPath = this.scene.getObjectByName('pathVisualization');
    if (existingPath) this.scene.remove(existingPath);

    const existingWaypoints = this.scene.getObjectByName('waypointMarkers');
    if (existingWaypoints) this.scene.remove(existingWaypoints);

    const existingArrows = this.scene.getObjectByName('directionArrows');
    if (existingArrows) this.scene.remove(existingArrows);

    // Create smooth path using Catmull-Rom curve
    const points = this.turnData.map(frame => {
      const pos = frame.position;
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    });

    const curve = new THREE.CatmullRomCurve3(points);
    const pathGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(1000));

    const pathMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 3,
      transparent: true,
      opacity: 0.9
    });

    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    pathLine.name = 'pathVisualization';
    this.scene.add(pathLine);

    console.log('✓ Path line created (green smooth curve)');

    // Create waypoint markers (unchanged)
    const waypointGroup = new THREE.Group();
    waypointGroup.name = 'waypointMarkers';

    const sampleRate = Math.max(1, Math.floor(this.turnData.length / 50));
    let waypointCount = 0;

    this.turnData.forEach((frame, idx) => {
      if (idx % sampleRate !== 0 && idx !== this.turnData.length - 1) return;

      let color, size = 0.4;
      switch (frame.turnType) {
        case 'straight': color = 0x00ff00; size = 0.3; break;
        case 'gentle': color = 0xffff00; size = 0.35; break;
        case 'sharp': color = 0xff8800; size = 0.4; break;
        case 'very_sharp': color = 0xff0000; size = 0.5; break;
        default: color = 0x0088ff; size = 0.3;
      }

      const waypointGeometry = new THREE.SphereGeometry(size, 16, 16);
      const waypointMaterial = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.6,
        metalness: 0.3,
        roughness: 0.4
      });

      const waypoint = new THREE.Mesh(waypointGeometry, waypointMaterial);
      waypoint.castShadow = true;
      waypoint.receiveShadow = true;

      const pos = frame.position;
      waypoint.position.set(pos.x, pos.y, pos.z);
      waypoint.userData = { frameIndex: idx, turnData: frame };

      waypointGroup.add(waypoint);
      waypointCount++;
    });

    this.scene.add(waypointGroup);
    console.log(`✓ ${waypointCount} waypoint markers created (color-coded by turn type)`);

    // Create direction arrows (unchanged)
    this.createDirectionArrows();
  }

  /**
   * Create arrow indicators showing turn direction (unchanged)
   */
  createDirectionArrows() {
    const existingArrows = this.scene.getObjectByName('directionArrows');
    if (existingArrows) this.scene.remove(existingArrows);

    const arrowGroup = new THREE.Group();
    arrowGroup.name = 'directionArrows';

    const sampleRate = Math.max(1, Math.floor(this.turnData.length / 20));
    let arrowCount = 0;

    for (let i = 0; i < this.turnData.length; i += sampleRate) {
      const frame = this.turnData[i];
      const nextFrame = this.turnData[Math.min(i + 1, this.turnData.length - 1)];

      const from = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
      const to = new THREE.Vector3(nextFrame.position.x, nextFrame.position.y, nextFrame.position.z);

      const direction = new THREE.Vector3().subVectors(to, from).normalize();
      const length = from.distanceTo(to) * 1.5;

      const arrowColor = frame.turnAngleDegrees > 0 ? 0xff0000 : 0x0000ff;
      const arrowHelper = new THREE.ArrowHelper(direction, from, Math.max(length, 1), arrowColor, 0.5, 0.3);

      arrowGroup.add(arrowHelper);
      arrowCount++;
    }

    this.scene.add(arrowGroup);
    console.log(`✓ ${arrowCount} direction arrows created (red=right, blue=left)`);
  }

  /**
   * Update camera to specific frame (for manual nav: sets pos + lookAt smoothly)
   */
  updateCameraPosition(frameIndex, duration = 500) {
    if (frameIndex < 0 || frameIndex >= this.turnData.length) return;

    const frame = this.turnData[frameIndex];
    const nextIdx = Math.min(frameIndex + 5, this.turnData.length - 1);
    const nextFrame = this.turnData[nextIdx];

    const startPos = this.camera.position.clone();
    const endPos = new THREE.Vector3(
      frame.position.x,
      frame.position.y + this.cameraHeight,
      frame.position.z
    );
    const startTarget = this.orbitControls.target.clone();
    const endTarget = new THREE.Vector3(
      nextFrame.position.x,
      nextFrame.position.y + this.cameraHeight,
      nextFrame.position.z
    );

    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = this.easeInOutCubic(progress); // Smooth easing

      this.camera.position.lerpVectors(startPos, endPos, easedProgress);
      this.orbitControls.target.lerpVectors(startTarget, endTarget, easedProgress);
      this.camera.lookAt(this.orbitControls.target);
      this.orbitControls.update();

      if (progress < 1) requestAnimationFrame(animate);
      else this.currentFrameIndex = frameIndex;
    };
    animate();
  }

  /**
   * Smooth transition to frame (now lerps camera pos + target for first-person follow)
   */
  smoothTransitionToFrame(targetFrameIndex, duration = 1000) {
    if (targetFrameIndex < 0 || targetFrameIndex >= this.turnData.length) return;

    const startFrame = this.turnData[this.currentFrameIndex];
    const endFrame = this.turnData[targetFrameIndex];
    const nextIdx = Math.min(targetFrameIndex + 5, this.turnData.length - 1);
    const endNextFrame = this.turnData[nextIdx];

    const startPos = this.camera.position.clone();
    const endPos = new THREE.Vector3(
      endFrame.position.x,
      endFrame.position.y + this.cameraHeight,
      endFrame.position.z
    );
    const startTarget = this.orbitControls.target.clone();
    const endTarget = new THREE.Vector3(
      endNextFrame.position.x,
      endNextFrame.position.y + this.cameraHeight,
      endNextFrame.position.z
    );

    const startTime = Date.now();
    const animateTransition = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = this.easeInOutCubic(progress);

      this.camera.position.lerpVectors(startPos, endPos, easedProgress);
      this.orbitControls.target.lerpVectors(startTarget, endTarget, easedProgress);
      this.camera.lookAt(this.orbitControls.target);
      this.orbitControls.update();

      if (progress < 1) {
        requestAnimationFrame(animateTransition);
      } else {
        this.currentFrameIndex = targetFrameIndex;
      }
    };

    animateTransition();
  }

  // Easing function for smoother transitions
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  /**
   * Start auto-play (now first-person along path)
   */
  startAutoPlay(frameDelay = 100) {
    this.isAutoPlay = true;
    this.animationSpeed = frameDelay;

    const playNext = () => {
      if (!this.isAutoPlay || !this.turnData) return;

      const nextIndex = (this.currentFrameIndex + 1) % this.turnData.length;
      this.smoothTransitionToFrame(nextIndex, frameDelay * 0.8);

      setTimeout(playNext, frameDelay);
    };

    playNext();
  }

  /**
   * Stop auto-play
   */
  stopAutoPlay() {
    this.isAutoPlay = false;
  }

  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    if (this.orbitControls) {
      this.orbitControls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handle window resize
   */
  onWindowResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);
  }

  /**
   * Dispose (enhanced cleanup)
   */
  dispose() {
    window.removeEventListener('resize', this.onWindowResize.bind(this));

    if (this.orbitControls) {
      this.orbitControls.dispose();
    }

    // Clean scene objects
    this.scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
      if (child.texture) child.texture.dispose();
    });
    this.scene.clear();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}

export default PanoramicSphereViewer;