/**
 * North definition for Mount Brockman Syncline project.
 *
 * Source of truth (GeoModeller MtBrockmanSyncline.xml):
 *   CoordSystem="GDA94 / MGA zone 50"
 *   unit="m"
 * Axis convention (GoCAD + GeoModeller, matches viewer coords):
 *   +X = Easting  (East)
 *   +Y = Northing (Grid North)
 *   +Z = Elevation (Up)
 *
 * Project centroid ≈ E 517524, N 7502060 → ≈ 22.588°S, 117.170°E
 * Grid convergence at centroid ≈ −0.065° (grid N slightly west of true N).
 * Magnetic declination (WMM-class estimate for Pilbara, epoch ~2026): +1.40° East of true N.
 * Grid-magnetic angle = Declination − Convergence ≈ +1.47°
 *   (magnetic north is east of grid/+Y by this amount).
 */
export const NORTH = {
  crs: "GDA94 / MGA zone 50",
  epsg: 28350,
  axis: {
    x: { name: "X", meaning: "Easting", direction: "East" },
    y: { name: "Y", meaning: "Northing", direction: "Grid North" },
    z: { name: "Z", meaning: "Elevation", direction: "Up" },
  },
  /** Degrees east of true north (negative = west). */
  gridConvergenceDeg: -0.065,
  /** Degrees east of true north. */
  magneticDeclinationDeg: 1.4,
  /** Magnetic north relative to grid/+Y, degrees toward +X (east). */
  get gridMagneticAngleDeg() {
    return this.magneticDeclinationDeg - this.gridConvergenceDeg;
  },
  centroidMga: { easting: 517524.1, northing: 7502059.5 },
  centroidWgs84: { lat: -22.58816, lon: 117.17048 },
};

/**
 * Camera view azimuth in degrees from Grid North (+Y) toward East (+X).
 * 0 = looking north, 90 = looking east.
 */
export function viewAzimuthFromGridNorth(camera) {
  const pos = camera.getPosition();
  const fp = camera.getFocalPoint();
  const dx = fp[0] - pos[0];
  const dy = fp[1] - pos[1];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}
