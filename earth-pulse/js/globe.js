import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js';
import { CONFIG } from './config.js';

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const expanded = value.length === 3
    ? value.split('').map((char) => char + char).join('')
    : value;
  const number = Number.parseInt(expanded, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function tooltipElement(event) {
  const element = document.createElement('div');
  element.className = 'globe-tooltip';
  const title = document.createElement('strong');
  title.textContent = event.title;
  element.append(title);
  return element;
}

function makeSatelliteObject() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 16, 16),
    new THREE.MeshBasicMaterial({ color: CONFIG.colors.orbit }),
  );
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.75, 32),
    new THREE.MeshBasicMaterial({
      color: CONFIG.colors.orbit,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  group.add(core, halo);
  return group;
}

function makeStars() {
  const count = 1200;
  const positions = new Float32Array(count * 3);
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < count; index += 1) {
    const radius = 650 + random() * 350;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xc9dded,
      size: 0.72,
      transparent: true,
      opacity: 0.64,
      sizeAttenuation: true,
      depthWrite: false,
    }),
  );
}

function makeNightOverlay(radius) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      nightOpacity: { value: 0.68 },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldNormal;
      uniform vec3 sunDirection;
      uniform float nightOpacity;
      void main() {
        float light = dot(normalize(vWorldNormal), normalize(sunDirection));
        float darkness = 1.0 - smoothstep(-0.12, 0.20, light);
        float edgeGlow = smoothstep(-0.18, 0.02, light) * (1.0 - smoothstep(0.02, 0.22, light));
        vec3 nightColor = vec3(0.005, 0.016, 0.045);
        vec3 twilightColor = vec3(0.045, 0.085, 0.16);
        vec3 color = mix(nightColor, twilightColor, edgeGlow * 0.7);
        gl_FragColor = vec4(color, darkness * nightOpacity);
      }
    `,
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.003, 96, 64),
    material,
  );
  mesh.renderOrder = 2;
  return mesh;
}

function makeSolarWind(radius) {
  const count = 180;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const offsetsA = new Float32Array(count);
  const offsetsB = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    phases[index] = Math.random();
    offsetsA[index] = (Math.random() - 0.5) * radius * 4.2;
    offsetsB[index] = (Math.random() - 0.5) * radius * 4.2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x9feaff,
    size: 0.62,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    points: new THREE.Points(geometry, material),
    phases,
    offsetsA,
    offsetsB,
    speed: 0.07,
    visible: true,
  };
}

export class EarthGlobe {
  constructor(container, callbacks = {}) {
    if (!window.Globe) throw new Error('Globe.gl failed to load');

    this.container = container;
    this.callbacks = callbacks;
    this.autoRotateRequested = true;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.sunDirection = new THREE.Vector3(1, 0, 0);
    this.solarWind = null;
    this.resumeTimer = null;
    this.animationFrame = null;
    this.lastParticleFrame = performance.now();

    this.globe = new window.Globe(container, {
      waitForGlobeReady: false,
      animateIn: !this.reducedMotion,
      rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' },
    })
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .globeImageUrl('./assets/textures/earth-dark.svg')
      .showAtmosphere(true)
      .atmosphereColor('#4d9ec7')
      .atmosphereAltitude(0.12)
      .showGraticules(false)
      .pointsData([])
      .pointLat('latitude')
      .pointLng('longitude')
      .pointColor('renderColor')
      .pointAltitude('renderAltitude')
      .pointRadius('renderRadius')
      .pointResolution(10)
      .pointsMerge(false)
      .pointsTransitionDuration(this.reducedMotion ? 0 : 700)
      .pointLabel(tooltipElement)
      .onPointClick((event) => this.callbacks.onSelect?.(event))
      .ringsData([])
      .ringLat('latitude')
      .ringLng('longitude')
      .ringColor('ringColor')
      .ringMaxRadius('ringRadius')
      .ringPropagationSpeed('ringSpeed')
      .ringRepeatPeriod('ringRepeat')
      .ringResolution(48)
      .objectsData([])
      .objectLat('latitude')
      .objectLng('longitude')
      .objectAltitude('altitude')
      .objectThreeObject(makeSatelliteObject)
      .objectFacesSurface(false)
      .objectLabel(tooltipElement)
      .onObjectClick((event) => this.callbacks.onSelect?.(event))
      .pathsData([])
      .pathPoints('points')
      .pathPointLat('lat')
      .pathPointLng('lng')
      .pathPointAlt('alt')
      .pathColor('color')
      .pathStroke(null)
      .pathDashLength(0.18)
      .pathDashGap(0.10)
      .pathDashAnimateTime(this.reducedMotion ? 0 : 8_000)
      .pathTransitionDuration(0)
      .onGlobeClick(() => this.callbacks.onDeselect?.());

    this.globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.globe.pointOfView({ lat: 18, lng: 142, altitude: 2.25 }, 0);

    const controls = this.globe.controls();
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !this.reducedMotion;
    controls.autoRotateSpeed = 0.18;
    controls.minDistance = this.globe.getGlobeRadius() * 1.25;
    controls.maxDistance = this.globe.getGlobeRadius() * 4.5;
    controls.addEventListener('start', () => this.pauseAutoRotateForInteraction());
    controls.addEventListener('end', () => this.scheduleAutoRotateResume());

    const radius = this.globe.getGlobeRadius();
    this.nightOverlay = makeNightOverlay(radius);
    this.stars = makeStars();
    this.solarWind = makeSolarWind(radius);
    this.globe.scene().add(this.stars, this.nightOverlay, this.solarWind.points);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.doubleClickHandler = (event) => {
      const rect = this.globe.renderer().domElement.getBoundingClientRect();
      const coords = this.globe.toGlobeCoords(event.clientX - rect.left, event.clientY - rect.top);
      if (coords) this.globe.pointOfView({ ...coords, altitude: 1.45 }, this.reducedMotion ? 0 : 900);
    };
    this.globe.renderer().domElement.addEventListener('dblclick', this.doubleClickHandler);

    this.animateSolarWind();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.globe.width(width).height(height);
  }

  pauseAutoRotateForInteraction() {
    clearTimeout(this.resumeTimer);
    this.globe.controls().autoRotate = false;
  }

  scheduleAutoRotateResume() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      if (this.autoRotateRequested && !this.reducedMotion) {
        this.globe.controls().autoRotate = true;
      }
    }, 4_500);
  }

  setAutoRotate(enabled) {
    this.autoRotateRequested = Boolean(enabled);
    this.globe.controls().autoRotate = Boolean(enabled) && !this.reducedMotion;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    this.globe.controls().autoRotate = this.autoRotateRequested && !this.reducedMotion;
  }

  setSunPosition(latitude, longitude) {
    const coords = this.globe.getCoords(latitude, longitude, 0);
    this.sunDirection.set(coords.x, coords.y, coords.z).normalize();
    this.nightOverlay.material.uniforms.sunDirection.value.copy(this.sunDirection);
  }

  setData(state) {
    const active = new Set(state.ui.activeLayers);
    const focus = state.ui.focusedLayer;
    const events = [...state.data.earthquakes, ...state.data.eonetEvents]
      .filter((event) => active.has(event.layer))
      .map((event) => {
        const focusAlpha = focus && event.layer !== focus ? 0.12 : 0.88;
        return {
          ...event,
          renderColor: hexToRgba(event.color, focusAlpha),
          renderRadius: event.displayRadius * (focus && event.layer !== focus ? 0.72 : 1),
          renderAltitude: event.displayAltitude,
        };
      });

    const recentEarthquakes = state.data.earthquakes
      .filter((event) => active.has('CRUST'))
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
      .slice(0, CONFIG.limits.quakeRings)
      .map((event) => ({
        ...event,
        ringColor: [hexToRgba(event.color, focus && focus !== 'CRUST' ? 0.08 : 0.62), 'rgba(0,0,0,0)'],
        ringRadius: 1.2 + event.intensity * 5.5,
        ringSpeed: 0.35 + event.intensity * 1.2,
        ringRepeat: this.reducedMotion ? 0 : 1_800 + (1 - event.intensity) * 2_200,
      }));

    this.globe.pointsData(events);
    this.globe.ringsData(recentEarthquakes);
    this.setSatelliteData(state);

    this.nightOverlay.visible = active.has('CORE');
    const spaceVisible = active.has('SPACE');
    this.solarWind.visible = spaceVisible;
    this.solarWind.points.visible = spaceVisible;
    this.setSpaceWeather(state.data.spaceWeather);
  }

  setSatelliteData(state) {
    const active = new Set(state.ui.activeLayers);
    const satellite = active.has('ORBIT') && state.data.satellite
      ? [state.data.satellite]
      : [];
    const showPath = satellite.length > 0
      && (state.ui.focusedLayer === 'ORBIT' || state.ui.selectedEventId === 'orbit:iss');

    this.globe.objectsData(satellite);
    this.globe.pathsData(showPath ? (state.data.satellite.paths || []) : []);
  }

  setSpaceWeather(spaceWeather) {
    const speed = Number(spaceWeather?.solarWindSpeed);
    const kp = Number(spaceWeather?.kp);
    this.solarWind.speed = Number.isFinite(speed)
      ? Math.min(0.22, Math.max(0.045, speed / 4_000))
      : 0.065;
    this.solarWind.points.material.opacity = Number.isFinite(speed)
      ? Math.min(0.48, 0.12 + speed / 1_500)
      : 0.18;

    if (Number.isFinite(kp) && kp >= 5) {
      this.globe.atmosphereColor('#7ad7ca');
      this.globe.atmosphereAltitude(0.15);
    } else if (Number.isFinite(kp) && kp >= 3) {
      this.globe.atmosphereColor('#68b7d1');
      this.globe.atmosphereAltitude(0.13);
    } else {
      this.globe.atmosphereColor('#4d9ec7');
      this.globe.atmosphereAltitude(0.12);
    }
  }

  animateSolarWind() {
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastParticleFrame) / 1000);
    this.lastParticleFrame = now;

    if (this.solarWind.visible && !this.reducedMotion) {
      const direction = this.sunDirection;
      const reference = Math.abs(direction.y) < 0.85
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const tangentA = new THREE.Vector3().crossVectors(direction, reference).normalize();
      const tangentB = new THREE.Vector3().crossVectors(direction, tangentA).normalize();
      const positions = this.solarWind.points.geometry.attributes.position.array;
      const radius = this.globe.getGlobeRadius();

      for (let index = 0; index < this.solarWind.phases.length; index += 1) {
        this.solarWind.phases[index] = (this.solarWind.phases[index] + delta * this.solarWind.speed) % 1;
        const distance = radius * (1.35 + (1 - this.solarWind.phases[index]) * 4.6);
        const lateralScale = 0.35 + this.solarWind.phases[index] * 0.65;
        const point = direction.clone().multiplyScalar(distance)
          .addScaledVector(tangentA, this.solarWind.offsetsA[index] * lateralScale)
          .addScaledVector(tangentB, this.solarWind.offsetsB[index] * lateralScale);
        positions[index * 3] = point.x;
        positions[index * 3 + 1] = point.y;
        positions[index * 3 + 2] = point.z;
      }
      this.solarWind.points.geometry.attributes.position.needsUpdate = true;
    }

    this.animationFrame = requestAnimationFrame(() => this.animateSolarWind());
  }

  focusEvent(event) {
    if (!event) return;
    this.globe.pointOfView({
      lat: event.latitude,
      lng: event.longitude,
      altitude: event.category === 'satellite' ? 1.65 : 1.45,
    }, this.reducedMotion ? 0 : 900);
  }

  destroy() {
    clearTimeout(this.resumeTimer);
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.globe.renderer().domElement.removeEventListener('dblclick', this.doubleClickHandler);
  }
}
