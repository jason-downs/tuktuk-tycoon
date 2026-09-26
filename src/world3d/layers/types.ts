import type { MeshLambertMaterial, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Game } from '../../sim/game';
import type { RideRequest } from '../../sim/types';
import type { UIState } from '../../ui/store';
import type { TiledCity } from '../build/world';
import type { EnvState } from './environment';

/** Services the 3D view offers its layers. Positions are sim metres (x east, y north). */
export interface ViewContext {
  readonly game: Game;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  /** Shared material for procedural models with linear vertex colours. */
  readonly modelMat: MeshLambertMaterial;
  /** Camera target and distance (metres). */
  readonly rig: { readonly tx: number; readonly ty: number; readonly dist: number; readonly yaw: number };
  /** Scale for vehicles and people so they stay readable when zoomed out. */
  vehicleScale(): number;
  /** Sideways offset (m) of traffic from the centreline on an arc: left-hand traffic. */
  laneOffset(arc: number): number;
  /** Put a vehicle model on an arc at s metres, in its lane, facing along the arc. */
  placeVehicle(obj: Object3D, arc: number, s: number, scale: number, lift?: number): void;
  /** Screen position (CSS px) of a sim point at height h, or null when off-camera. */
  screenOf(x: number, y: number, h?: number): { x: number; y: number } | null;
  /** Where a waiting passenger stands: beside the road node, towards the place. */
  kerbOf(req: RideRequest): { x: number; y: number };
  /**
   * The object that follows a fleet vehicle's rendered pose, if drawn: position
   * on the ground at the vehicle's centre, rotation.y its heading, scale its
   * render scale. It has no geometry of its own (the fleet is instanced), but
   * objects added to it ride along with the vehicle.
   */
  vehicleMesh(id: number): Object3D | undefined;
  /** Request under the mouse, for hover effects. */
  readonly hoverRequest: number | null;
  /** The generated static city (props, trees, stats), once the worker has finished. */
  city(): TiledCity | null;
  /** Add a layer (e.g. effects that need the city); it is updated every frame from then on. */
  addLayer(layer: WorldLayer): void;
  /** What the environment published this frame (night level, lamps, rain…); it updates before the other layers. */
  envState(): Readonly<EnvState>;
}

export interface FrameInfo {
  now: number;
  /** Real seconds since the last frame. */
  dt: number;
  /** Game hour of day, 0–24. */
  hour: number;
  ui: UIState;
}

/** A self-contained part of the 3D world, updated every frame. */
export interface WorldLayer {
  readonly id: string;
  update(frame: FrameInfo): void;
  dispose(): void;
}
