import type { Material } from 'three';

export type ShaderPatch = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void;

/**
 * Chain a shader patch onto a material that may already have one (the city
 * material converts sRGB colours). three.js shares compiled programs between
 * materials with the same cache key, and the default key is the source of
 * onBeforeCompile, so the key is taken from the material as it stands before
 * this patch wraps it: materials with different earlier patches keep
 * different keys once they share this one.
 */
export function patchMaterial(mat: Material, key: string, patch: ShaderPatch): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  const base = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? null : prev.toString();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader);
  };
  mat.customProgramCacheKey = () => `${base ?? prevKey.call(mat)}|${key}`;
  mat.needsUpdate = true;
}
