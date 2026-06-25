// Máscara invertida (escurece tudo fora do campus) + contorno tracejado.
// Cantos arredondados via Bezier quadrático — porta exata do IFrota.py.

function arredondarAnel(ring, smoothness = 0.12, maxDistDeg = 0.00015) {
  if (!ring || ring.length < 4) return ring;
  smoothness = Math.max(0, Math.min(0.45, smoothness));
  const r = ring.slice();
  if (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  const n = r.length;
  const out = [];
  const steps = 8;
  for (let i = 0; i < n; i++) {
    const prev = r[(i - 1 + n) % n];
    const curr = r[i];
    const next = r[(i + 1) % n];
    const vpx = prev[0] - curr[0], vpy = prev[1] - curr[1];
    const vnx = next[0] - curr[0], vny = next[1] - curr[1];
    const lenP = Math.hypot(vpx, vpy);
    const lenN = Math.hypot(vnx, vny);
    const distP = Math.min(lenP * smoothness, maxDistDeg);
    const distN = Math.min(lenN * smoothness, maxDistDeg);
    const A = [curr[0] + (vpx / lenP) * distP, curr[1] + (vpy / lenP) * distP];
    const B = [curr[0] + (vnx / lenN) * distN, curr[1] + (vny / lenN) * distN];
    out.push(A);
    for (let t = 1; t < steps; t++) {
      const u = t / steps;
      const omu = 1 - u;
      const x = omu * omu * A[0] + 2 * omu * u * curr[0] + u * u * B[0];
      const y = omu * omu * A[1] + 2 * omu * u * curr[1] + u * u * B[1];
      out.push([x, y]);
    }
    out.push(B);
  }
  out.push(out[0]);
  return out;
}

export function aplicarMascaraCampus(map, campusPoly, { dark = false } = {}) {
  if (!campusPoly || campusPoly.length < 3) return;

  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  // campusPoly chega como [[lat, lon], ...] — MapLibre quer [lon, lat]
  const sharpRing = campusPoly.map(([lat, lon]) => [lon, lat]);
  if (
    sharpRing[0][0] !== sharpRing[sharpRing.length - 1][0] ||
    sharpRing[0][1] !== sharpRing[sharpRing.length - 1][1]
  ) sharpRing.push(sharpRing[0]);

  const ring = arredondarAnel(sharpRing, 0.12, 0.00012);

  for (const id of ["campus-mask", "campus-outline"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }

  map.addSource("campus-mask", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "Polygon", coordinates: [world, ring] } },
  });
  map.addLayer({
    id: "campus-mask", source: "campus-mask", type: "fill",
    paint: { "fill-color": "#000", "fill-opacity": 0.45 },
  });

  map.addSource("campus-outline", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } },
  });
  map.addLayer({
    id: "campus-outline", source: "campus-outline", type: "line",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": dark ? "#ffffff" : "#0a0a0a",
      "line-width": 3,
      "line-dasharray": [2, 2],
    },
  });
}
