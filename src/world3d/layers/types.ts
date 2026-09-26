import type { Mesh, MeshLambertMaterial, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Game } from '../../sim/game';
import type { RideRequest } from '../../sim/types';
import type { UIState } from '../../ui/store';
import type { BuiltCity } from '../build/world';

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
  /** The fleet mesh for a vehicle id, if drawn. */
  vehicleMesh(id: number): Mesh | undefined;
  /** Request under the mouse, for hover effects. */
  readonly hoverRequest: number | null;
  /** The generated static city (props, trees, stats), once the worker has finished. */
  city(): BuiltCity | null;
  /** Add a layer (e.g. effects that need the city); it is updated every frame from then on. */
  addLayer(layer: WorldLayer): void;
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
