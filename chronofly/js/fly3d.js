const T = window.THREE;

const _dir = T ? new T.Vector3() : null;
const _UP = T ? new T.Vector3(0, 1, 0) : null;
const UNIT_CYL = T ? new T.CylinderGeometry(1, 1, 1, 6) : null;

function seg(mesh, ax, ay, az, bx, by, bz, r) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length() || 1e-4;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.scale.set(r, len, r);
  _dir.divideScalar(len);
  mesh.quaternion.setFromUnitVectors(_UP, _dir);
}

export function createFly3D(hex) {
  const col = new T.Color(hex);
  const bodyMat = new T.MeshPhongMaterial({
    color: 0x4a3421, emissive: col.clone().multiplyScalar(0.5),
    shininess: 70, specular: 0x554433
  });
  const g = new T.Group();

  const belly = new T.Mesh(new T.SphereGeometry(0.4, 16, 12), bodyMat.clone());
  belly.material.emissive = col.clone().multiplyScalar(0.4);
  belly.position.set(-0.42, 0.5, 0);
  belly.scale.set(1.4, 0.85, 0.85);
  const thorax = new T.Mesh(new T.SphereGeometry(0.42, 16, 12), bodyMat);
  thorax.position.set(0.1, 0.52, 0);
  thorax.scale.set(1.1, 0.9, 0.9);
  const head = new T.Mesh(new T.SphereGeometry(0.24, 14, 10), bodyMat);
  head.position.set(0.55, 0.48, 0);
  g.add(belly, thorax, head);

  const eyeMat = new T.MeshBasicMaterial({ color: col });
  [-1, 1].forEach((s) => {
    const eye = new T.Mesh(new T.SphereGeometry(0.085, 10, 8), eyeMat);
    eye.position.set(0.72, 0.53, s * 0.14);
    g.add(eye);
  });

  [-1, 1].forEach((s) => {
    const stalk = new T.Mesh(UNIT_CYL.clone(), bodyMat);
    seg(stalk, 0.62, 0.55, s * 0.08, 0.95, 0.72, s * 0.16, 0.02);
    g.add(stalk);
  });

  const wingMat = new T.MeshBasicMaterial({
    color: 0xbfe9ff, transparent: true, opacity: 0.4,
    side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false
  });
  const wings = [];
  [-1, 1].forEach((s) => {
    const pivot = new T.Group();
    pivot.position.set(-0.1, 0.82, s * 0.14);
    const blade = new T.Mesh(new T.PlaneGeometry(1.0, 0.44), wingMat);
    blade.position.x = s * 0.5;
    pivot.add(blade);
    pivot.rotation.x = s * 0.25;
    g.add(pivot);
    wings.push({ pivot, side: s });
  });

  const legMat = new T.MeshPhongMaterial({
    color: col.clone().multiplyScalar(0.7), emissive: col.clone().multiplyScalar(0.35),
    shininess: 30
  });
  const hipX = [0.32, 0.05, -0.22];
  for (let i = 0; i < 6; i += 1) {
    const side = i < 3 ? 1 : -1;
    const hx = hipX[i % 3];
    const kneeX = hx + 0.1, kneeY = 0.28, kneeZ = side * 0.34;
    const footX = hx - 0.08, footY = 0.12, footZ = side * 0.4;
    const thigh = new T.Mesh(UNIT_CYL, legMat);
    const shin = new T.Mesh(UNIT_CYL, legMat);
    seg(thigh, hx, 0.42, side * 0.2, kneeX, kneeY, kneeZ, 0.035);
    seg(shin, kneeX, kneeY, kneeZ, footX, footY, footZ, 0.026);
    g.add(thigh, shin);
  }

  const halo = new T.Mesh(new T.SphereGeometry(0.05, 6, 6), new T.MeshBasicMaterial({ color: col }));
  halo.position.set(0, 1.3, 0);
  g.add(halo);

  const disc = new T.Mesh(
    new T.CircleGeometry(0.62, 18),
    new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;

  return {
    group: g,
    wings,
    disc,
    setFlap(phase) {
      const flap = Math.sin(phase) * 0.85;
      for (const w of wings) w.pivot.rotation.z = w.side * (0.15 + flap);
    }
  };
}

export function createTrail(hex, maxPoints) {
  const geo = new T.BufferGeometry();
  const arr = new Float32Array(maxPoints * 3);
  geo.setAttribute('position', new T.BufferAttribute(arr, 3));
  geo.setDrawRange(0, 0);
  const line = new T.Line(geo, new T.LineBasicMaterial({
    color: new T.Color(hex), transparent: true, opacity: 0.75,
    blending: T.AdditiveBlending, depthWrite: false
  }));
  return {
    line,
    set(points, count) {
      const n = Math.min(count, maxPoints);
      for (let i = 0; i < n; i += 1) {
        arr[i * 3] = points[i].x;
        arr[i * 3 + 1] = points[i].y;
        arr[i * 3 + 2] = points[i].z;
      }
      geo.attributes.position.needsUpdate = true;
      geo.setDrawRange(0, n);
    }
  };
}
