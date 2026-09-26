// Light, sky, weather and festival atmosphere for the 3D city, driven by the
// game clock, the sim's weather and the events calendar:
// - The sun follows its real path over Chiang Mai (env/sun.ts); the key light,
//   sky, hemisphere light, fog and exposure blend through morning, day, golden
//   hour, blue hour and night keyframes by sun elevation (env/lighting.ts),
//   with the moon as a dim key light at night.
// - Weather (env/atmosphere.ts) darkens and greys the light for rain and
//   storms (with lightning), brings mist over the water on cool-season
//   mornings, and browns the air in smoky haze until Doi Suthep disappears.
//   Roads darken and pick up a sheen when wet.
// - Street lamps, lit windows (CityLayer.setNight), festival lanterns,
//   candles, krathongs and market stalls come and go with the time and date.
// - Graphics quality (env/quality.ts) sets the shadow map, the pixel ratio and
//   particle counts.

import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  SRGBColorSpace,
  Vector3,
  type MeshLambertMaterial,
} from 'three';
import { calendar, DAY, HOUR, type CalendarInfo } from '../../sim/clock';
import { currentWeather } from '../../sim/weather';
import {
  atmosphereLook,
  CLEAR_BACKDROP_HAZE,
  cloneLook,
  easeLook,
  lightningFlash,
  stepWetness,
  type AtmosphereLook,
} from '../env/atmosphere';
import { luminance, type RGB } from '../env/colour';
import { festivalsAt, type FestivalState } from '../env/festivals';
import { KEYS, timeOfDay } from '../env/lighting';
import { onQualityChange, QUALITY_LEVELS, qualityLevel, qualityPreset, renderPixelRatio, setQuality } from '../env/quality';
import { moonIllumination, moonPhase, moonPosition, skyDirection, solarPosition } from '../env/sun';
import { Mist, Rain, Splashes } from './effects';
import { FestivalDecor } from './festivals';
import type { GlowFrame } from './glow';
import { NightLights } from './nightLights';
import { Sky } from './sky';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** The key light never comes from lower than this, so late-afternoon shadows stay inside the shadow box. */
const MIN_LIGHT_ELEVATION = 7 * DEG;
/** Rain pool size: the high preset's count; lower presets draw a share of it. */
const RAIN_POOL = 12_000;
const DAY_FOG_LUMINANCE = luminance(KEYS.day.fog);

/** What the environment publishes each frame for other layers (headlights, rain curtains, …). */
export interface EnvState {
  /** Windows and headlights: 0 by day … 1 at night (dark storms raise it). */
  night: number;
  /** Street lamps 0–1. */
  lamps: number;
  rain: number;
  storm: number;
  /** Road wetness 0–1. */
  wet: number;
  haze: number;
  mist: number;
  /** Lightning flash this frame 0–1. */
  flash: number;
  festivals: FestivalState;
}

/** CityLayer material hooks the environment adjusts (wet roads, aerial haze on the mountains). */
type CityMaterials = Partial<Record<'roads' | 'ground' | 'backdrop', MeshLambertMaterial>>;

type ShaderPatch = (shader: { uniforms: Record<string, { value: unknown }>; fragmentShader: string }) => void;

/** Chain a shader patch onto a material that may already have one (the city material converts sRGB colours). */
function patchMaterial(mat: MeshLambertMaterial, key: string, patch: ShaderPatch): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader);
  };
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|${key}`;
  mat.needsUpdate = true;
}

export class Environment implements WorldLayer {
  readonly id = 'environment';
  /** Background fallback; the sky dome covers it. */
  readonly sky = new Color('#a9cbe6');
  readonly fog = new Fog('#a9cbe6', 400, 3000);
  readonly hemi = new HemisphereLight('#cfe3f5', '#b89f7a', 1.1);
  readonly sun = new DirectionalLight('#fff4e0', 2.2);
  /** Direction towards the key light (sun, or the moon at night), world space. */
  readonly sunDir = new Vector3(0.5, 0.8, 0.3);
  /** 0 at night … 1 in full daylight (1 − EnvState.night). */
  light = 1;
  /** Called when the light level changes (e.g. to light windows at night). */
  onLight: ((light: number) => void) | null = null;
  readonly state: EnvState = { night: 0, lamps: 0, rain: 0, storm: 0, wet: 0, haze: 0, mist: 0, flash: 0, festivals: festivalsAt(0) };

  private readonly ctx: ViewContext;
  private readonly skyDome: Sky;
  private readonly rain: Rain;
  private mist: Mist | null = null;
  private splashes: Splashes | null = null;
  private nightLights: NightLights | null = null;
  private festivals: FestivalDecor | null = null;
  private cityReady = false;
  private look: AtmosphereLook | null = null;
  private target: AtmosphereLook | null = null;
  private wet = 0;
  private lastTime = Number.NaN;
  private festivalMinute = -1;
  private devHandle = false;
  private readonly unsubscribe: () => void;
  // Shader uniforms shared with patched city materials.
  private readonly uWet = { value: 0 };
  private readonly uSheen = { value: new Color() };
  private readonly uAerial = { value: 0 };
  private readonly uAerialColor = { value: new Color() };
  // Scratch colours and vectors.
  private readonly c = {
    fog: new Color(),
    horizon: new Color(),
    zenith: new Color(),
    tint: new Color(),
    key: new Color(),
    sunColor: new Color(),
    cloudLit: new Color(),
    cloudShade: new Color(),
    rain: new Color(),
    mist: new Color(),
    grey: new Color(),
    white: new Color(1, 1, 1),
  };
  private readonly moonDir = new Vector3(0, -1, 0);
  private readonly skySunDir = new Vector3(0, 1, 0);
  private readonly viewTarget = new Vector3();
  private readonly glow: GlowFrame;

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const { scene } = ctx;
    scene.background = this.sky;
    scene.fog = this.fog;
    scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(qualityPreset().shadowMapSize, qualityPreset().shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.skyDome = new Sky(scene);
    this.rain = new Rain(scene, RAIN_POOL);
    this.unsubscribe = onQualityChange(() => this.applyQuality());
    this.glow = { time: 0, camera: ctx.camera, viewportHeight: 1, fogNear: this.fog.near, fogFar: this.fog.far };
  }

  /** Hook the city's materials: wet roads and ground, and aerial haze on the Doi Suthep backdrop. */
  setCityMaterials(mats: CityMaterials): void {
    const wet = (m: MeshLambertMaterial | undefined, strength: number) => {
      if (!m) return;
      patchMaterial(m, `wet${strength}`, (shader) => {
        shader.uniforms.uWet = this.uWet;
        shader.uniforms.uSheen = this.uSheen;
        shader.fragmentShader =
          'uniform float uWet;\nuniform vec3 uSheen;\n' +
          shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `float wetF = uWet * ${strength.toFixed(2)};
  float wetFres = 0.05 + 0.6 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  outgoingLight = outgoingLight * (1.0 - 0.3 * wetF) + uSheen * wetFres * wetF;
  #include <opaque_fragment>`,
          );
      });
    };
    wet(mats.roads, 1);
    wet(mats.ground, 0.45);
    if (mats.backdrop) {
      patchMaterial(mats.backdrop, 'aerial', (shader) => {
        shader.uniforms.uAerial = this.uAerial;
        shader.uniforms.uAerialColor = this.uAerialColor;
        shader.fragmentShader =
          'uniform float uAerial;\nuniform vec3 uAerialColor;\n' +
          shader.fragmentShader.replace(
            '#include <fog_fragment>',
            '#include <fog_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uAerialColor, uAerial);',
          );
      });
    }
  }

  private applyQuality(): void {
    const q = qualityPreset();
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== q.shadowMapSize) {
      shadow.map?.dispose();
      shadow.map = null;
      shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    }
    this.ctx.renderer.setPixelRatio(renderPixelRatio());
    // Particle pools are sized from the preset when they are built.
    this.mist?.dispose();
    this.mist = null;
    this.splashes?.dispose();
    this.splashes = null;
    this.cityReady = false;
  }

  /** City-dependent parts, once the build worker has delivered the city. */
  private attachCity(): void {
    const built = this.ctx.city();
    if (!built) return;
    const q = qualityPreset();
    const { scene, modelMat } = this.ctx;
    this.nightLights ??= new NightLights(scene, built.props);
    this.festivals ??= new FestivalDecor(scene, modelMat, built.props);
    if (built.props.fx_mist) this.mist ??= new Mist(scene, built.props.fx_mist, q.mistPuffs);
    if (built.props.fx_moat) this.splashes ??= new Splashes(scene, built.props.fx_moat, q.splashDrops);
    this.cityReady = true;
  }

  update(frame: FrameInfo): void {
    const { rig, renderer, camera, game } = this.ctx;
    const time = game.state.time;
    const cal = calendar(time);
    const real = frame.now / 1000;
    if (!this.cityReady) this.attachCity();
    if (import.meta.env.DEV && !this.devHandle) this.exposeDevHandle();

    // ---- sun, moon and the time-of-day look
    const sun = solarPosition(cal);
    const phase = moonPhase(time);
    const lit = moonIllumination(phase);
    const moon = moonPosition(sun, phase);
    const tod = timeOfDay(sun.elevation, sun.hourAngle < 0, moon.elevation, lit);
    skyDirection(sun, this.skySunDir);
    skyDirection(moon, this.moonDir);

    // ---- weather and festivals (re-read once per game minute); the look eases over a couple of seconds
    const jump = !Number.isFinite(this.lastTime) || Math.abs(time - this.lastTime) > 2 * HOUR;
    const minute = minuteIndex(cal);
    if (minute !== this.festivalMinute || jump || !this.target) {
      this.festivalMinute = minute;
      this.state.festivals = festivalsAt(time);
      this.target = atmosphereLook(currentWeather(game), cal);
    }
    const target = this.target;
    if (!this.look || jump) this.look = cloneLook(target);
    else easeLook(this.look, target, 1 - Math.exp(-frame.dt / 1.2));
    const look = this.look;
    const fest = this.state.festivals;
    const wetTarget = Math.max(target.wet, fest.songkran > 0 ? 0.55 * fest.songkran : 0);
    this.wet = jump ? wetTarget : stepWetness(this.wet, wetTarget, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const flash = lightningFlash(real, look.storm);

    // ---- colours
    const c = this.c;
    this.atmosphericColour(tod.fog, look, c.fog);
    this.atmosphericColour(tod.horizon, look, c.horizon);
    // Murk that hides the mountains also swallows the horizon glow: the sky meets the fog colour.
    const murk = clamp((look.backdropHide - CLEAR_BACKDROP_HAZE) / (1 - CLEAR_BACKDROP_HAZE), 0, 1);
    c.horizon.lerp(c.fog, murk);
    this.linear(tod.zenith, c.zenith).lerp(c.fog, clamp(look.cloud * 0.55 + look.haze * 0.6, 0, 0.9));
    c.zenith.multiplyScalar(1 - look.darken * 0.45);
    this.sky.copy(c.fog);
    this.fog.color.copy(c.fog);
    // Key light: the sun, or the moon at night.
    this.linear(tod.key, c.key).lerp(this.linear(look.keyTint, c.tint), look.keyTintAmount);
    this.desaturate(c.key, look.desaturate * 0.5);
    const keyIntensity = tod.keyIntensity * look.keyMul;
    this.sun.color.copy(c.key);
    this.sun.intensity = keyIntensity;
    const keyPos = tod.moonKey ? moon : sun;
    skyDirection({ elevation: Math.max(MIN_LIGHT_ELEVATION, keyPos.elevation), azimuth: keyPos.azimuth }, this.sunDir);
    this.linear(tod.hemiSky, this.hemi.color);
    this.desaturate(this.hemi.color, look.desaturate * 0.7);
    this.linear(tod.hemiGround, this.hemi.groundColor);
    this.hemi.intensity = tod.hemiIntensity * look.hemiMul + flash * 2.5;
    renderer.toneMappingExposure = tod.exposure + look.darken * 0.08;

    // ---- fog distances follow the camera distance; weather pulls them in
    const near = (rig.dist * 1.4 + 250) * look.fogNear;
    this.fog.near = near;
    this.fog.far = Math.max(near + 60, (rig.dist * 4.5 + 1600) * look.fogFar);

    // ---- night, lamps and windows
    const stormDark = smoothstep(0.25, 0.6, look.darken);
    this.state.night = clamp(Math.max(tod.night, stormDark * 0.55), 0, 1);
    this.state.lamps = Math.max(tod.lamps, stormDark * 0.8);
    Object.assign(this.state, { rain: look.rain, storm: look.storm, wet: this.wet, haze: look.haze, mist: look.mist, flash });
    const light = 1 - this.state.night;
    if (Math.abs(light - this.light) > 0.004 || (light !== this.light && (light === 0 || light === 1))) {
      this.light = light;
      this.onLight?.(light);
    }

    // ---- city materials
    this.uWet.value = this.wet;
    this.uSheen.value.copy(c.horizon).lerp(c.white, 0.15).multiplyScalar(0.9);
    this.uAerial.value = look.backdropHide;
    this.uAerialColor.value.copy(c.fog).convertLinearToSRGB();

    // ---- sky dome
    c.sunColor.set(tod.keyIntensity > 0.1 && !tod.moonKey ? c.key : c.tint.set('#ff8a4a'));
    if (look.haze > 0) c.sunColor.lerp(c.tint.set('#ff5a2a'), look.haze * 0.6);
    const brightness = luminance(tod.horizon) ** 0.7;
    c.cloudLit.copy(c.horizon).lerp(c.grey.setScalar(brightness * 1.05), 0.5).multiplyScalar(1 - 0.5 * look.darken);
    c.cloudShade.copy(c.cloudLit).multiplyScalar(0.72 - 0.25 * look.storm);
    this.viewTarget.set(rig.tx, 0, -rig.ty);
    this.skyDome.update(
      camera.position,
      {
        time: real,
        zenith: c.zenith,
        horizon: c.horizon,
        fog: c.fog,
        sunDir: this.skySunDir,
        sunColor: c.sunColor,
        sunGlow: tod.sunGlow,
        moonDir: this.moonDir,
        moonGlow: smoothstep(-2 * DEG, 4 * DEG, moon.elevation) * (0.35 + 0.65 * tod.stars),
        cloud: look.cloud,
        cloudLit: c.cloudLit,
        cloudShade: c.cloudShade,
        stars: tod.stars,
        flash,
        haze: look.haze,
        lift: murk,
        pixelRatio: renderer.getPixelRatio(),
      },
      this.viewTarget,
    );

    // ---- shadows: the sun only, not too low, not zoomed right out
    this.updateShadowBox();
    this.sun.castShadow = !tod.moonKey && sun.elevation > 2 * DEG && keyIntensity > 0.25 && rig.dist < 2500;

    // ---- particles and night lights
    const q = qualityPreset();
    const dayLight = 1 - this.state.night * 0.8;
    c.rain.copy(c.fog).lerp(c.white, 0.35).multiplyScalar(0.55 + 0.45 * dayLight);
    const vh = renderer.domElement.height;
    const rainShare = q.rainStreaks / RAIN_POOL;
    this.rain.update(real, camera, vh, this.viewTarget, rig.dist, look.rain, rainShare, c.rain, 0.35 + 0.3 * look.storm);
    c.mist.copy(c.fog).multiplyScalar(1.08);
    this.mist?.update(real, look.mist, c.mist);
    const glow = Object.assign(this.glow, { time: real, viewportHeight: vh, fogNear: this.fog.near, fogFar: this.fog.far });
    const splash = fest.songkran * smoothstep(-2 * DEG, 4 * DEG, sun.elevation);
    this.splashes?.update(real, camera, vh, rig.tx, rig.ty, rig.dist, splash, dayLight);
    this.nightLights?.update(glow, this.state.lamps, 1 + 0.8 * this.wet);
    this.festivals?.update({ glow, state: fest, night: this.state.night, krathongs: q.krathongs });
  }

  /** Linear three.js colour of an sRGB byte colour. */
  private linear(rgb: RGB, out: Color): Color {
    return out.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace);
  }

  private desaturate(col: Color, amount: number): void {
    if (amount <= 0) return;
    const l = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    col.lerp(this.c.grey.setScalar(l), amount);
  }

  /**
   * A time-of-day colour (fog or horizon) after the weather: tinted towards
   * the weather's colour (kept at the time of day's brightness, so haze is
   * brown by day and dark at night), desaturated and darkened.
   */
  private atmosphericColour(base: RGB, look: AtmosphereLook, out: Color): Color {
    this.linear(base, out);
    if (look.fogTintAmount > 0.001) {
      const scale = luminance(base) / DAY_FOG_LUMINANCE;
      this.linear(look.fogTint, this.c.tint).multiplyScalar(scale);
      out.lerp(this.c.tint, clamp(look.fogTintAmount, 0, 1));
    }
    this.desaturate(out, look.desaturate * 0.6);
    return out.multiplyScalar(1 - look.darken * 0.35);
  }

  /** Shadow box centred on the camera target, snapped to shadow texels so it doesn't shimmer. */
  private updateShadowBox(): void {
    const { rig } = this.ctx;
    const extent = clamp(rig.dist * 1.3, 80, 700);
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 3000;
    cam.updateProjectionMatrix();
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    const cx = Math.round(rig.tx / texel) * texel;
    const cy = Math.round(rig.ty / texel) * texel;
    this.sun.target.position.set(cx, 0, -cy);
    this.sun.position.set(cx + this.sunDir.x * 1200, this.sunDir.y * 1200, -cy + this.sunDir.z * 1200);
  }

  /** Dev builds: window.__world3d.quality.set('low' | 'medium' | 'high'). */
  private exposeDevHandle(): void {
    const handle = (window as unknown as { __world3d?: Record<string, unknown> }).__world3d;
    if (!handle) return;
    this.devHandle = true;
    handle.quality = { levels: QUALITY_LEVELS, get: qualityLevel, set: setQuality };
  }

  dispose(): void {
    const scene = this.ctx.scene;
    this.unsubscribe();
    scene.remove(this.hemi, this.sun, this.sun.target);
    this.sun.dispose();
    this.hemi.dispose();
    this.skyDome.dispose();
    this.rain.dispose();
    this.mist?.dispose();
    this.splashes?.dispose();
    this.nightLights?.dispose();
    this.festivals?.dispose();
  }
}

/** Game minute index of a calendar reading (festival state refreshes once per game minute). */
export function minuteIndex(cal: CalendarInfo): number {
  return cal.day * (DAY / 60) + Math.floor(cal.hour * 60);
}
