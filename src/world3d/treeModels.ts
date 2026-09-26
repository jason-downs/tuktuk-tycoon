// Tree geometries for the instanced vegetation, trunk base at the origin.

import { BoxGeometry, IcosahedronGeometry, Matrix4, type BufferGeometry } from 'three';
import { build, cylAt, type Part } from './models';

/** Tree geometries per kind, ~30–60 triangles each, trunk base at the origin. */
export function treeGeometry(kind: string): BufferGeometry {
  const trunk = '#5b4a3a';
  switch (kind) {
    case 'rain': {
      const crown = new IcosahedronGeometry(1, 1);
      crown.scale(7.5, 2.8, 7.5);
      crown.translate(0, 7, 0);
      return build([cylAt(0.35, 6, 0, 3, 0, trunk, 'y', 6, 0.25), { geo: crown, color: '#4a7a37' }]);
    }
    case 'palm': {
      const parts: Part[] = [cylAt(0.18, 9, 0, 4.5, 0, '#8a7b66', 'y', 5, 0.14)];
      for (let i = 0; i < 7; i++) {
        const leaf = new BoxGeometry(3.4, 0.08, 0.7);
        leaf.translate(1.6, 0, 0);
        leaf.applyMatrix4(new Matrix4().makeRotationZ(-0.35));
        leaf.applyMatrix4(new Matrix4().makeRotationY((i / 7) * Math.PI * 2));
        leaf.translate(0, 9, 0);
        parts.push({ geo: leaf, color: '#6a9a3a' });
      }
      return build(parts);
    }
    case 'yang': {
      const crown = new IcosahedronGeometry(1, 0);
      crown.scale(5, 3.5, 5);
      crown.translate(0, 21, 0);
      return build([cylAt(0.45, 20, 0, 10, 0, '#7d746a', 'y', 6, 0.3), { geo: crown, color: '#557d3a' }]);
    }
    case 'bodhi': {
      const crown = new IcosahedronGeometry(1, 1);
      crown.scale(6.5, 4.5, 6.5);
      crown.translate(0, 7.5, 0);
      return build([cylAt(0.55, 5.5, 0, 2.75, 0, trunk, 'y', 6, 0.4), { geo: crown, color: '#5d8f3c' }]);
    }
    default: {
      const crown = new IcosahedronGeometry(1, 0);
      crown.scale(3.4, 3.4, 3.4);
      crown.translate(0, 5.2, 0);
      return build([cylAt(0.25, 3.6, 0, 1.8, 0, trunk, 'y', 5, 0.18), { geo: crown, color: '#5f8f3c' }]);
    }
  }
}
