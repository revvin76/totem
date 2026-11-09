import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const rainbow = [
  [0, '#20d9ff'], [.24, '#3564ee'], [.48, '#9d38f0'], [.7, '#ff269c'], [1, '#ffc12a'],
].map(([position, color]) => [position, new THREE.Color(color)]);

export function createTotemPole() {
  const root = new THREE.Group();
  root.name = 'Totem pole';
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1038', roughness: .58 });
  const satin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .03 });
  const inset = new THREE.MeshStandardMaterial({ color: '#25114e', roughness: .5 });
  const pearl = new THREE.MeshStandardMaterial({ color: '#f5e9ff', roughness: .42 });
  const painted = new THREE.Color();
  function mesh(geometry, material, x, y, z) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    root.add(part);
    return part;
  }
  function paint(geometry, fraction) {
    const points = geometry.attributes.position;
    const colors = new Float32Array(points.count * 3);
    for (let i = 0; i < points.count; i++) {
      const t = THREE.MathUtils.clamp(fraction(points.getX(i), points.getY(i)), 0, 1);
      const index = rainbow.findIndex(([stop]) => stop >= t);
      const [start, color] = rainbow[Math.max(0, index - 1)];
      const [end, next] = rainbow[index];
      painted.copy(color).lerp(next, end === start ? 0 : (t - start) / (end - start)).toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }
  function shell(width, height, depth, radius, y, z) {
    const geometry = new RoundedBoxGeometry(width, height, depth, 8, radius);
    return mesh(paint(geometry, (x, dy) => .5 + .83 * x / width + .16 * dy / height), satin, 0, y, z);
  }
  function box(width, height, depth, radius, material, y, z) {
    return mesh(new RoundedBoxGeometry(width, height, depth, 8, radius), material, 0, y, z);
  }

  // The D-pad and wings are already part of Little Totem. These are the
  // controller buttons, play tier and plinth from the full emblem.
  box(1.48, .23, .96, .10, dark, .115, 0);
  shell(1.37, .18, .9, .08, .18, .02);
  box(1.22, .54, .76, .14, dark, .49, 0);
  shell(1.13, .49, .76, .14, .5, .065);
  box(.72, .34, .14, .065, inset, .5, .451);
  const play = new THREE.Shape().moveTo(-.078, -.09).lineTo(.09, 0).lineTo(-.078, .09).closePath();
  mesh(new THREE.ExtrudeGeometry(play, { depth: .021, bevelSegments: 3, bevelSize: .012, bevelThickness: .009 }), pearl, 0, .5, .53);

  box(1.04, .56, .72, .13, dark, .99, 0);
  // Local mounting surface and body width at the top of the controller tier.
  root.userData.totemRest = { anchor: [0, 1.27, 0], width: 1.04 };
  shell(.98, .51, .72, .12, 1, .053);
  box(.84, .44, .14, .067, pearl, 1, .39);
  const buttonShape = new THREE.SphereGeometry(1, 32, 24);
  for (const [x, y, color] of [[0, 1.127, '#ffbb21'], [-.19, 1, '#00c6ff'], [.19, 1, '#ff248a'], [0, .873, '#a830fa']]) {
    mesh(buttonShape, inset, x, y, .451).scale.set(.101, .101, .043);
    const enamel = new THREE.MeshStandardMaterial({ color, roughness: .38, metalness: .02 });
    mesh(buttonShape, enamel, x, y, .481).scale.set(.082, .082, .047);
  }

  const orbit = paint(new THREE.TorusGeometry(.8, .019, 8, 80), x => .5 + x / 1.6);
  const ribbon = mesh(orbit, satin, 0, .44, 0);
  ribbon.scale.x = 1.24;
  ribbon.rotation.set(1.43, .09, .23);

  return {
    root,
    dispose() {
      const geometries = new Set(), materials = new Set();
      for (const part of root.children) {
        geometries.add(part.geometry);
        materials.add(part.material);
      }
      for (const resource of [...geometries, ...materials]) resource.dispose();
      root.removeFromParent();
    },
  };
}
