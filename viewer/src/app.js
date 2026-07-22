/**
 * Mount Brockman Syncline — vtk.js solid geological viewer
 * Primary: GoCAD VS* volumetric shells as opaque vtkPolyData solids
 * Colors / relations: GeoModeller
 */
import "@kitware/vtk.js/Rendering/Profiles/Geometry";

import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkCellArray from "@kitware/vtk.js/Common/Core/CellArray";
import vtkPoints from "@kitware/vtk.js/Common/Core/Points";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkSphereSource from "@kitware/vtk.js/Filters/Sources/SphereSource";
import vtkInteractorStyleManipulator from "@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator";
import vtkMouseCameraTrackballRotateManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator";
import vtkMouseCameraTrackballPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkMouseCameraTrackballZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";
import vtkOrientationMarkerWidget from "@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget";
import vtkAxesActor from "@kitware/vtk.js/Rendering/Core/AxesActor";
import { NORTH, viewAzimuthFromGridNorth } from "./north.js";
import { createSectionViewer } from "./section.js";

const DATA = "/data";

const state = {
  catalog: null,
  actors: new Map(), // id → { actor, mapper, polydata, meta, rawPositions, rawIndices }
  origin: [0, 0, 0],
  zExag: 1.2,
  solidOpacity: 1.0,
  selectedId: null,
  /** Stack of removed solids for Undo (most recent last). */
  removedSolids: [],
  volumeCache: new Map(), // id → { m3, km3 }
  gravityRaw: null,
  renderer: null,
  renderWindow: null,
  interactor: null,
  interactorStyle: null,
  orientationWidget: null,
  section: null,
};

const el = {
  pick: document.getElementById("pick-info"),
  solidList: document.getElementById("solid-list"),
  faultList: document.getElementById("fault-list"),
  horizonList: document.getElementById("horizon-list"),
  overlayList: document.getElementById("overlay-list"),
  relationBox: document.getElementById("relation-box"),
  legend: document.getElementById("legend-swatches"),
  solidOpacity: document.getElementById("solid-opacity"),
  solidOpacityVal: document.getElementById("solid-opacity-val"),
  zExag: document.getElementById("z-exag"),
  zExagVal: document.getElementById("z-exag-val"),
  overlayViewer: document.getElementById("overlay-viewer"),
  overlayImg: document.getElementById("overlay-img"),
  overlayCaption: document.getElementById("overlay-caption"),
  compassRose: document.getElementById("compass-rose"),
  sectionEnable: document.getElementById("section-enable"),
  sectionStatus: document.getElementById("section-status"),
  secPickX: document.getElementById("sec-pick-x"),
  secPickY: document.getElementById("sec-pick-y"),
  secPickZ: document.getElementById("sec-pick-z"),
  solidProps: document.getElementById("solid-props"),
  solidPropsTitle: document.getElementById("solid-props-title"),
  solidPropsBody: document.getElementById("solid-props-body"),
  solidPropsVolume: document.getElementById("solid-props-volume"),
  solidPropsClose: document.getElementById("solid-props-close"),
  btnSolidVolume: document.getElementById("btn-solid-volume"),
  btnSolidRemove: document.getElementById("btn-solid-remove"),
  btnUndoSolid: document.getElementById("btn-undo-solid"),
};

function setStatus(msg) {
  if (el.pick && msg) el.pick.textContent = msg;
}

function updateCompass() {
  if (!state.renderer || !el.compassRose) return;
  const cam = state.renderer.getActiveCamera();
  if (!cam) return;
  const viewAz = viewAzimuthFromGridNorth(cam);
  const magFromGrid = NORTH.gridMagneticAngleDeg;
  el.compassRose.style.transform = `rotate(${-(viewAz - magFromGrid)}deg)`;
}

function setupOrientationAndCompass() {
  const axesActor = vtkAxesActor.newInstance();
  axesActor.setXAxisColor([220, 60, 50]);
  axesActor.setYAxisColor([46, 200, 110]);
  axesActor.setZAxisColor([50, 140, 230]);

  const widget = vtkOrientationMarkerWidget.newInstance({
    actor: axesActor,
    interactor: state.interactor,
  });
  widget.setParentRenderer(state.renderer);
  widget.setEnabled(true);
  widget.setViewportCorner(vtkOrientationMarkerWidget.Corners.TOP_LEFT);
  widget.setViewportSize(0.14);
  widget.setMinPixelSize(96);
  widget.setMaxPixelSize(160);
  state.orientationWidget = widget;

  const syncHud = () => {
    updateCompass();
    if (state.orientationWidget?.getEnabled()) {
      state.orientationWidget.updateMarkerOrientation();
    }
  };

  state.interactor.onAnimation(syncHud);
  state.interactor.onEndAnimation(syncHud);
  state.interactor.onMouseMove(syncHud);
  state.renderer.getActiveCamera().onModified(syncHud);
  syncHud();
}

function hexToRgb01(hex) {
  const h = (hex || "#888888").replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** GoCAD (E,N,Elev) → vtk (x,y,z) with local origin + Z exaggeration */
function transformPositions(src, origin, zExag) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] - origin[0];
    out[i + 1] = src[i + 1] - origin[1];
    out[i + 2] = (src[i + 2] - origin[2]) * zExag;
  }
  return out;
}

function indicesToCells(indices) {
  const nTris = indices.length / 3;
  const cells = new Uint32Array(nTris * 4);
  for (let t = 0; t < nTris; t++) {
    const o = t * 4;
    const i = t * 3;
    cells[o] = 3;
    cells[o + 1] = indices[i];
    cells[o + 2] = indices[i + 1];
    cells[o + 3] = indices[i + 2];
  }
  return cells;
}

async function loadMeshBin(relPath) {
  const res = await fetch(`${DATA}/${relPath}`);
  if (!res.ok) throw new Error(`Failed ${relPath}`);
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "MB3D") throw new Error(`Bad magic ${relPath}`);
  const nVerts = view.getUint32(4, true);
  const nTris = view.getUint32(8, true);
  const posOffset = 16;
  const posBytes = nVerts * 12;
  const positions = new Float32Array(buf, posOffset, nVerts * 3).slice();
  const indices = new Uint32Array(buf, posOffset + posBytes, nTris * 3).slice();
  return { positions, indices };
}

function buildPolyData(positions, indices, origin, zExag) {
  const pts = transformPositions(positions, origin, zExag);
  const cells = indicesToCells(indices);

  const points = vtkPoints.newInstance();
  points.setData(pts, 3);

  const polys = vtkCellArray.newInstance();
  polys.setData(cells);

  const pd = vtkPolyData.newInstance();
  pd.setPoints(points);
  pd.setPolys(polys);
  return pd;
}

function styleActor(actor, meta) {
  const prop = actor.getProperty();
  const [r, g, b] = hexToRgb01(meta.color);
  prop.setColor(r, g, b);
  prop.setOpacity(meta.defaultOpacity ?? 1);
  prop.setInterpolationToPhong();
  prop.setAmbient(0.22);
  prop.setDiffuse(0.78);
  prop.setSpecular(0.18);
  prop.setSpecularPower(18);
  prop.setBackfaceCulling(false);
  prop.setEdgeVisibility(false);

  if (meta.kind === "solid") {
    // Opaque geological solid body — core of the viewer
    prop.setOpacity(state.solidOpacity);
    prop.setRepresentationToSurface();
  } else if (meta.kind === "fault") {
    prop.setOpacity(0.75);
    prop.setSpecular(0.35);
  } else if (meta.kind === "topo") {
    prop.setOpacity(0.35);
    prop.setAmbient(0.35);
  } else if (meta.kind === "horizon") {
    prop.setOpacity(0.45);
    prop.setRepresentationToSurface();
  }
}

async function addMeshActor(meta) {
  const { positions, indices } = await loadMeshBin(meta.file);
  const polydata = buildPolyData(positions, indices, state.origin, state.zExag);
  const mapper = vtkMapper.newInstance({ scalarVisibility: false });
  mapper.setInputData(polydata);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  styleActor(actor, meta);
  actor.setVisibility(meta.defaultVisible !== false);
  state.renderer.addActor(actor);
  state.actors.set(meta.id, {
    actor,
    mapper,
    polydata,
    meta,
    rawPositions: positions,
    rawIndices: indices,
  });
  return actor;
}

function rebuildTransformedGeometry() {
  for (const entry of state.actors.values()) {
    if (!entry.rawPositions) continue;
    const pd = buildPolyData(
      entry.rawPositions,
      entry.rawIndices,
      state.origin,
      state.zExag
    );
    entry.mapper.setInputData(pd);
    if (entry.polydata) entry.polydata.delete();
    entry.polydata = pd;
  }
  rebuildWells();
  rebuildGravity();
  if (state.section?.isEnabled()) state.section.rebuild();
  else state.renderWindow.render();
}

function linePolyData(pointsXYZ) {
  // pointsXYZ: flat [x,y,z,...] already in scene coords
  const n = pointsXYZ.length / 3;
  const points = vtkPoints.newInstance();
  points.setData(Float32Array.from(pointsXYZ), 3);
  const lines = new Uint32Array(n + 1);
  lines[0] = n;
  for (let i = 0; i < n; i++) lines[i + 1] = i;
  const cells = vtkCellArray.newInstance();
  cells.setData(lines);
  const pd = vtkPolyData.newInstance();
  pd.setPoints(points);
  pd.setLines(cells);
  return pd;
}

const wellActors = [];
const gravityActors = [];

function clearActors(list) {
  for (const a of list) {
    state.renderer.removeActor(a);
    a.delete();
  }
  list.length = 0;
}

function rebuildWells() {
  clearActors(wellActors);
  if (!state.catalog) return;
  const { origin, zExag } = state;
  for (const well of state.catalog.wells) {
    const flat = [];
    for (const [x, y, z] of well.path) {
      flat.push(x - origin[0], y - origin[1], (z - origin[2]) * zExag);
    }
    const pd = linePolyData(flat);
    const mapper = vtkMapper.newInstance({ scalarVisibility: false });
    mapper.setInputData(pd);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setColor(1, 0.85, 0.35);
    actor.getProperty().setLineWidth(2);
    actor.setVisibility(document.getElementById("btn-wells").classList.contains("active"));
    state.renderer.addActor(actor);
    wellActors.push(actor);

    const sphere = vtkSphereSource.newInstance({
      radius: 40,
      thetaResolution: 12,
      phiResolution: 12,
    });
    const [cx, cy, cz] = well.collar;
    sphere.setCenter(cx - origin[0], cy - origin[1], (cz - origin[2]) * zExag);
    const sm = vtkMapper.newInstance();
    sm.setInputConnection(sphere.getOutputPort());
    const sa = vtkActor.newInstance();
    sa.setMapper(sm);
    sa.getProperty().setColor(1, 0.75, 0.2);
    sa.setVisibility(actor.getVisibility());
    state.renderer.addActor(sa);
    wellActors.push(sa);
  }
}

async function loadGravity() {
  const res = await fetch(`${DATA}/gravity.bin`);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "MBGR") return null;
  const count = view.getUint32(4, true);
  return { count, data: new Float32Array(buf, 8, count * 4) };
}

function rebuildGravity() {
  clearActors(gravityActors);
  if (!state.gravityRaw || !state.catalog) return;
  const { origin, zExag } = state;
  const { data, count } = state.gravityRaw;
  const [rMin, rMax] = state.catalog.gravity.residualRange;
  const pts = new Float32Array(count * 3);
  const scalars = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pts[i * 3] = data[i * 4] - origin[0];
    pts[i * 3 + 1] = data[i * 4 + 1] - origin[1];
    pts[i * 3 + 2] = (data[i * 4 + 2] - origin[2]) * zExag;
    scalars[i] = data[i * 4 + 3];
  }
  const points = vtkPoints.newInstance();
  points.setData(pts, 3);
  const verts = new Uint32Array(count * 2);
  for (let i = 0; i < count; i++) {
    verts[i * 2] = 1;
    verts[i * 2 + 1] = i;
  }
  const cells = vtkCellArray.newInstance();
  cells.setData(verts);
  const pd = vtkPolyData.newInstance();
  pd.setPoints(points);
  pd.setVerts(cells);
  const da = vtkDataArray.newInstance({
    name: "residual",
    values: scalars,
    numberOfComponents: 1,
  });
  pd.getPointData().setScalars(da);

  const mapper = vtkMapper.newInstance();
  mapper.setInputData(pd);
  mapper.setScalarRange(rMin, rMax);
  mapper.setColorByArrayName("residual");
  mapper.setScalarModeToUsePointFieldData();
  mapper.setColorModeToMapScalars();

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setPointSize(3);
  actor.setVisibility(document.getElementById("btn-gravity").classList.contains("active"));
  state.renderer.addActor(actor);
  gravityActors.push(actor);
}

function makeLayerRow(meta) {
  const row = document.createElement("label");
  row.className = "layer-item";
  row.dataset.id = meta.id;
  const entry = state.actors.get(meta.id);
  const vis = entry ? entry.actor.getVisibility() : meta.defaultVisible;
  row.innerHTML = `
    <input type="checkbox" ${vis ? "checked" : ""} />
    <span class="swatch" style="background:${meta.color}"></span>
    <span>${meta.label}</span>
    <span class="code">${meta.code || ""}</span>
  `;
  const cb = row.querySelector("input");
  cb.addEventListener("change", () => {
    if (entry) {
      entry.actor.setVisibility(cb.checked);
      state.renderWindow.render();
    }
  });
  row.addEventListener("click", (e) => {
    if (e.target === cb) return;
    selectLayer(meta.id);
  });
  return row;
}

function fillLists() {
  const solids = [...state.catalog.solids].sort((a, b) => a.ageOrder - b.ageOrder);
  const faults = state.catalog.surfaces
    .filter((s) => s.kind === "fault")
    .sort((a, b) => a.code.localeCompare(b.code));
  const horizons = state.catalog.surfaces
    .filter((s) => s.kind === "horizon")
    .sort((a, b) => a.ageOrder - b.ageOrder);

  el.solidList.innerHTML = "";
  solids.forEach((s) => el.solidList.appendChild(makeLayerRow(s)));
  el.faultList.innerHTML = "";
  faults.forEach((s) => el.faultList.appendChild(makeLayerRow(s)));
  el.horizonList.innerHTML = "";
  horizons.forEach((s) => el.horizonList.appendChild(makeLayerRow(s)));

  el.legend.innerHTML = "";
  for (const s of solids) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `<i style="background:${s.color}"></i><span>${s.code} ${s.label}</span>`;
    el.legend.appendChild(row);
  }

  el.overlayList.innerHTML = "";
  for (const img of state.catalog.images || []) {
    const name = img.split("/").pop();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = name.replace(/_/g, " ").replace(".jpg", "");
    btn.addEventListener("click", () => {
      el.overlayImg.src = `${DATA}/${img}`;
      el.overlayCaption.textContent = name;
      el.overlayViewer.classList.remove("hidden");
    });
    el.overlayList.appendChild(btn);
  }
}

function updateUndoButton() {
  if (!el.btnUndoSolid) return;
  const n = state.removedSolids.length;
  el.btnUndoSolid.disabled = n === 0;
  el.btnUndoSolid.title =
    n === 0
      ? "Restore last removed solid"
      : `Restore ${state.removedSolids[n - 1].meta.label}`;
  el.btnUndoSolid.textContent = n ? `Undo (${n})` : "Undo";
}

/**
 * Closed-shell volume via divergence theorem (sum of tetrahedra to origin).
 * Uses raw world coordinates (m) — display Z-exaggeration is ignored.
 */
function computeClosedShellVolumeM3(positions, indices) {
  let sum = 0;
  const nTris = indices.length / 3;
  for (let t = 0; t < nTris; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const bx = positions[i1];
    const by = positions[i1 + 1];
    const bz = positions[i1 + 2];
    const cx = positions[i2];
    const cy = positions[i2 + 1];
    const cz = positions[i2 + 2];
    sum +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(sum) / 6;
}

function formatVolume(m3) {
  if (m3 >= 1e9) return `${(m3 / 1e9).toFixed(3)} km³`;
  if (m3 >= 1e6) return `${(m3 / 1e6).toFixed(3)} Mm³`;
  return `${m3.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`;
}

function hideSolidProps() {
  if (!el.solidProps) return;
  el.solidProps.classList.add("hidden");
  el.solidProps.setAttribute("aria-hidden", "true");
  if (el.solidPropsVolume) el.solidPropsVolume.textContent = "";
}

function showSolidProps(meta) {
  if (!el.solidProps || meta.kind !== "solid") {
    hideSolidProps();
    return;
  }
  el.solidPropsTitle.textContent = meta.label;
  const b = meta.bounds;
  const pile = state.catalog?.stratigraphy?.youngToOld || [];
  const pilePos = pile.indexOf(meta.code);
  const younger = pilePos > 0 ? pile[pilePos - 1] : "—";
  const older =
    pilePos >= 0 && pilePos < pile.length - 1 ? pile[pilePos + 1] : "—";
  const faults = (meta.faultedBy || []).join(", ") || "—";
  el.solidPropsBody.innerHTML = `
    <dl>
      <div class="prop-row"><dt>Unit code</dt><dd>${meta.code || "—"}</dd></div>
      <div class="prop-row"><dt>GoCAD</dt><dd>${meta.sourceFile || meta.id}</dd></div>
      <div class="prop-row"><dt>Lithology</dt><dd>${meta.lithology || "—"}</dd></div>
      <div class="prop-row"><dt>Color</dt><dd><span class="swatch-inline" style="background:${meta.color}"></span>${meta.color}</dd></div>
      <div class="prop-row"><dt>Age order</dt><dd>${meta.ageOrder ?? "—"} (1 = oldest in pile)</dd></div>
      <div class="prop-row"><dt>Stratigraphy</dt><dd>younger ${younger} → this → older ${older}</dd></div>
      <div class="prop-row"><dt>Faulted by</dt><dd>${faults}</dd></div>
      <div class="prop-row"><dt>Vertices</dt><dd>${(meta.vertexCount || 0).toLocaleString()}</dd></div>
      <div class="prop-row"><dt>Triangles</dt><dd>${(meta.triangleCount || 0).toLocaleString()}</dd></div>
      <div class="prop-row"><dt>Bounds E</dt><dd>${b ? `${b.min[0].toFixed(0)} – ${b.max[0].toFixed(0)} mE` : "—"}</dd></div>
      <div class="prop-row"><dt>Bounds N</dt><dd>${b ? `${b.min[1].toFixed(0)} – ${b.max[1].toFixed(0)} mN` : "—"}</dd></div>
      <div class="prop-row"><dt>Elevation</dt><dd>${b ? `${b.min[2].toFixed(1)} – ${b.max[2].toFixed(1)} m RL` : "—"}</dd></div>
      <div class="prop-row"><dt>Smoothing</dt><dd>${meta.smoothed ? meta.smoothMethod || "yes" : "none"}</dd></div>
    </dl>
  `;
  const cached = state.volumeCache.get(meta.id);
  el.solidPropsVolume.textContent = cached
    ? `Volume: ${formatVolume(cached.m3)} (${cached.km3.toFixed(4)} km³)`
    : "Volume: — (press Volume)";
  el.solidProps.classList.remove("hidden");
  el.solidProps.setAttribute("aria-hidden", "false");
}

function selectLayer(id) {
  state.selectedId = id;
  document.querySelectorAll(".layer-item").forEach((n) => {
    n.classList.toggle("selected", n.dataset.id === id);
  });

  const entry = state.actors.get(id);
  if (!entry) {
    hideSolidProps();
    return;
  }
  const meta = entry.meta;

  for (const [mid, e] of state.actors) {
    const prop = e.actor.getProperty();
    if (mid === id) {
      prop.setAmbient(0.45);
      prop.setSpecular(0.4);
    } else {
      prop.setAmbient(0.22);
      prop.setSpecular(e.meta.kind === "fault" ? 0.35 : 0.18);
    }
  }
  state.renderWindow.render();

  el.pick.textContent = `${meta.label}  [${meta.code || "—"}]\n${meta.lithology || meta.kind}\n${meta.triangleCount.toLocaleString()} triangles · vtk.js solid=${meta.solid ? "yes" : "no"}`;
  el.relationBox.innerHTML = renderRelations(meta);

  if (meta.kind === "solid") showSolidProps(meta);
  else hideSolidProps();
}

function removeSelectedSolid() {
  const id = state.selectedId;
  if (!id) return;
  const entry = state.actors.get(id);
  if (!entry || entry.meta.kind !== "solid") return;

  state.renderer.removeActor(entry.actor);
  state.actors.delete(id);
  state.removedSolids.push({
    meta: entry.meta,
    rawPositions: entry.rawPositions,
    rawIndices: entry.rawIndices,
  });
  entry.polydata?.delete?.();
  entry.mapper?.delete?.();
  entry.actor?.delete?.();

  state.selectedId = null;
  hideSolidProps();
  document.querySelectorAll(".layer-item").forEach((n) => {
    n.classList.toggle("selected", false);
  });
  const row = document.querySelector(`.layer-item[data-id="${id}"]`);
  if (row) row.remove();
  updateUndoButton();
  state.renderWindow.render();
  el.pick.textContent = `Removed ${entry.meta.label}`;
}

function restoreRemovedSolid() {
  const saved = state.removedSolids.pop();
  if (!saved) {
    updateUndoButton();
    return;
  }
  const { meta, rawPositions, rawIndices } = saved;
  const polydata = buildPolyData(rawPositions, rawIndices, state.origin, state.zExag);
  const mapper = vtkMapper.newInstance({ scalarVisibility: false });
  mapper.setInputData(polydata);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  styleActor(actor, meta);
  actor.setVisibility(true);
  state.renderer.addActor(actor);
  state.actors.set(meta.id, {
    actor,
    mapper,
    polydata,
    meta,
    rawPositions,
    rawIndices,
  });

  if (el.solidList) {
    const solids = [...state.catalog.solids]
      .filter((s) => state.actors.has(s.id))
      .sort((a, b) => a.ageOrder - b.ageOrder);
    el.solidList.innerHTML = "";
    solids.forEach((s) => el.solidList.appendChild(makeLayerRow(s)));
  }

  updateUndoButton();
  state.renderWindow.render();
  selectLayer(meta.id);
  el.pick.textContent = `Restored ${meta.label}`;
}

function computeSelectedVolume() {
  const id = state.selectedId;
  if (!id) return;
  const entry = state.actors.get(id);
  if (!entry || entry.meta.kind !== "solid") return;
  if (el.solidPropsVolume) el.solidPropsVolume.textContent = "Computing volume…";
  // Yield so the status can paint before the heavy loop
  requestAnimationFrame(() => {
    const m3 = computeClosedShellVolumeM3(entry.rawPositions, entry.rawIndices);
    const km3 = m3 / 1e9;
    state.volumeCache.set(id, { m3, km3 });
    if (el.solidPropsVolume) {
      el.solidPropsVolume.textContent = `Volume: ${formatVolume(m3)} (${km3.toFixed(4)} km³) · closed shell, world metres`;
    }
  });
}

function wireSolidPropsUi() {
  el.solidPropsClose?.addEventListener("click", () => {
    hideSolidProps();
  });
  el.btnSolidRemove?.addEventListener("click", () => {
    removeSelectedSolid();
  });
  el.btnSolidVolume?.addEventListener("click", () => {
    computeSelectedVolume();
  });
  el.btnUndoSolid?.addEventListener("click", () => {
    restoreRemovedSolid();
  });
  updateUndoButton();
}

function renderRelations(meta) {
  const cat = state.catalog;
  if (meta.kind === "solid") {
    const faults = (meta.faultedBy || [])
      .map((f) => `<span class="tag">${f}</span>`)
      .join(" ");
    const pilePos = cat.stratigraphy.youngToOld.indexOf(meta.code);
    const above = pilePos > 0 ? cat.stratigraphy.youngToOld[pilePos - 1] : "—";
    const below =
      pilePos >= 0 && pilePos < cat.stratigraphy.youngToOld.length - 1
        ? cat.stratigraphy.youngToOld[pilePos + 1]
        : "—";
    return `
      <strong>SOLID ${meta.label}</strong> <span class="tag">${meta.code}</span><br/>
      GoCAD <em>VS*</em> closed volumetric shell → vtk.js PolyData surface (solid body).<br/>
      <b>Lithology:</b> ${meta.lithology}<br/>
      <b>Stratigraphy:</b> younger <span class="tag">${above}</span> → this → older <span class="tag">${below}</span><br/>
      <b>Cut by faults:</b><br/>${faults}<br/>
      Color from GeoModeller <em>ColorShading</em>.
    `;
  }
  if (meta.kind === "fault") {
    const stops = meta.stopsOn?.length
      ? meta.stopsOn.map((f) => `<span class="tag">${f}</span>`).join(" ")
      : "<em>through-going</em>";
    const cuts = (meta.cutsFormations || [])
      .slice(0, 10)
      .map((c) => `<span class="tag">${c}</span>`)
      .join(" ");
    return `
      <strong>Fault ${meta.code}</strong><br/>
      <b>Stops on:</b> ${stops}<br/>
      <b>Cuts solid formations:</b><br/>${cuts}…<br/>
      Faults displace solid lithology contacts (InfluencedByFault on Folded_Series).
    `;
  }
  if (meta.kind === "horizon") {
    return `
      <strong>Contact ${meta.label}</strong> <span class="tag">${meta.code}</span><br/>
      GoCAD <em>S*</em> horizon — optional overlay of solid boundaries (off by default).
    `;
  }
  if (meta.kind === "topo") {
    return `<strong>Topography</strong><br/>DTM over solids. Translucent to avoid hiding volume shells.`;
  }
  return "—";
}

function syncSectionPickButtons() {
  const id = state.section?.getCurrentId();
  document.querySelectorAll(".section-presets button[data-sec]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sec === id);
  });
}

function readSectionOptionsFromUi() {
  const hideVolumes = document.getElementById("section-hide-vol")?.checked ?? false;
  return {
    fill: true,
    patch: document.getElementById("section-patch")?.checked ?? true,
    contacts: document.getElementById("section-contacts")?.checked ?? true,
    faults: document.getElementById("section-faults")?.checked ?? true,
    topo: document.getElementById("section-topo")?.checked ?? true,
    hideVolumes,
    // Default: clip away the front half; keep the solid behind the cut plane.
    clipVolumes: !hideVolumes,
  };
}

async function openSection(id) {
  if (!state.section) return;
  state.section.setOptions(readSectionOptionsFromUi(), { rebuild: false });
  await state.section.show(id);
  if (el.sectionEnable) el.sectionEnable.checked = true;
  syncSectionPickButtons();
}

function closeSection() {
  state.section?.hide();
  if (el.sectionEnable) el.sectionEnable.checked = false;
  syncSectionPickButtons();
}

function populateSectionPicker(index) {
  const groups = {
    x: el.secPickX,
    y: el.secPickY,
    z: el.secPickZ,
  };
  for (const g of Object.values(groups)) {
    if (g) g.innerHTML = "";
  }
  for (const s of index.sections || []) {
    const host = groups[s.axis];
    if (!host) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.sec = s.id;
    btn.textContent = s.id;
    btn.title = `${s.name} — place section face on cut plane in 3D`;
    btn.addEventListener("click", () => {
      openSection(s.id).catch((err) => {
        console.error(err);
        if (el.sectionStatus) el.sectionStatus.textContent = String(err.message || err);
      });
    });
    host.appendChild(btn);
  }
}

async function initSectionViewer() {
  state.section = createSectionViewer({
    renderer: state.renderer,
    renderWindow: state.renderWindow,
    getOrigin: () => state.origin,
    getZExag: () => state.zExag,
    getEntries: () => state.actors.values(),
    statusEl: el.sectionStatus,
  });
  try {
    const index = await state.section.loadIndex();
    populateSectionPicker(index);
    if (el.sectionStatus) {
      el.sectionStatus.textContent = `Ready · ${index.sections.length} cut planes`;
    }
  } catch (err) {
    console.error(err);
    if (el.sectionStatus) {
      el.sectionStatus.textContent = "Section data missing — run cross-section/generate.mjs";
    }
  }
}

function wireSectionUi() {
  if (!el.sectionEnable) return;

  el.sectionEnable.addEventListener("change", () => {
    if (el.sectionEnable.checked) {
      const id = state.section?.getCurrentId() || "X1";
      openSection(id).catch((err) => {
        console.error(err);
        el.sectionEnable.checked = false;
        if (el.sectionStatus) el.sectionStatus.textContent = String(err.message || err);
      });
    } else {
      closeSection();
    }
  });

  for (const id of [
    "section-patch",
    "section-contacts",
    "section-faults",
    "section-topo",
    "section-hide-vol",
  ]) {
    document.getElementById(id)?.addEventListener("change", () => {
      if (!state.section?.isEnabled()) return;
      state.section.setOptions(readSectionOptionsFromUi());
    });
  }
}

function setGroupVisibility(kinds, on) {
  for (const e of state.actors.values()) {
    if (kinds.includes(e.meta.kind)) {
      e.actor.setVisibility(on);
      const row = document.querySelector(`.layer-item[data-id="${e.meta.id}"] input`);
      if (row) row.checked = on;
    }
  }
  state.renderWindow.render();
}

function wireUi() {
  document.getElementById("btn-fit").addEventListener("click", () => {
    state.renderer.resetCamera();
    syncInteractionCenter(state.interactorStyle);
    state.renderWindow.render();
  });

  const bindToggle = (id, kinds, extra) => {
    const btn = document.getElementById(id);
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      const on = btn.classList.contains("active");
      if (kinds) setGroupVisibility(kinds, on);
      if (extra) extra(on);
    });
  };

  bindToggle("btn-solids", ["solid"]);
  bindToggle("btn-faults", ["fault"]);
  bindToggle("btn-horizons", ["horizon"]);
  bindToggle("btn-topo", ["topo"]);
  bindToggle("btn-wells", null, (on) => {
    wellActors.forEach((a) => a.setVisibility(on));
    state.renderWindow.render();
  });
  bindToggle("btn-gravity", null, (on) => {
    gravityActors.forEach((a) => a.setVisibility(on));
    state.renderWindow.render();
  });

  el.solidOpacity.addEventListener("input", () => {
    state.solidOpacity = +el.solidOpacity.value;
    el.solidOpacityVal.textContent = state.solidOpacity.toFixed(2);
    for (const e of state.actors.values()) {
      if (e.meta.kind === "solid") {
        e.actor.getProperty().setOpacity(state.solidOpacity);
      }
    }
    state.renderWindow.render();
  });

  el.zExag.addEventListener("input", () => {
    state.zExag = +el.zExag.value;
    el.zExagVal.textContent = `${state.zExag.toFixed(1)}×`;
    rebuildTransformedGeometry();
  });

  document.getElementById("overlay-close").addEventListener("click", () => {
    el.overlayViewer.classList.add("hidden");
  });

  wireSectionUi();
  wireSolidPropsUi();
}

function setupCameraInteraction(interactor, container) {
  const style = vtkInteractorStyleManipulator.newInstance();

  // Left drag → rotate
  const rotate = vtkMouseCameraTrackballRotateManipulator.newInstance({
    button: 1,
  });
  // Right drag → pan (scene / camera follows mouse direction)
  const panRight = vtkMouseCameraTrackballPanManipulator.newInstance({
    button: 3,
  });
  // Middle drag → pan (optional)
  const panMiddle = vtkMouseCameraTrackballPanManipulator.newInstance({
    button: 2,
  });
  // Shift + left → pan
  const panShift = vtkMouseCameraTrackballPanManipulator.newInstance({
    button: 1,
    shift: true,
  });
  // Wheel → zoom
  const zoomScroll = vtkMouseCameraTrackballZoomManipulator.newInstance({
    dragEnabled: false,
    scrollEnabled: true,
  });
  // Ctrl + left drag → zoom
  const zoomCtrl = vtkMouseCameraTrackballZoomManipulator.newInstance({
    button: 1,
    control: true,
  });

  style.addMouseManipulator(rotate);
  style.addMouseManipulator(panRight);
  style.addMouseManipulator(panMiddle);
  style.addMouseManipulator(panShift);
  style.addMouseManipulator(zoomScroll);
  style.addMouseManipulator(zoomCtrl);

  interactor.setInteractorStyle(style);

  // Suppress browser context menu so right-drag can pan
  container.addEventListener("contextmenu", (e) => e.preventDefault());

  return style;
}

function syncInteractionCenter(style) {
  if (!style || !state.renderer) return;
  const cam = state.renderer.getActiveCamera();
  if (!cam) return;
  style.setCenterOfRotation(cam.getFocalPoint());
}

function setupVtk() {
  const root = document.getElementById("vtk-root");
  const fullScreen = vtkFullScreenRenderWindow.newInstance({
    rootContainer: root,
    containerStyle: {
      height: "100%",
      width: "100%",
      position: "absolute",
      background: "rgb(14, 18, 22)",
    },
  });
  // Remove default vtk controller UI if present
  const ctrl = root.querySelector(".vtk-controller");
  if (ctrl) ctrl.style.display = "none";

  state.renderer = fullScreen.getRenderer();
  state.renderWindow = fullScreen.getRenderWindow();
  state.interactor = fullScreen.getInteractor();
  state.interactorStyle = setupCameraInteraction(state.interactor, root);
  setupOrientationAndCompass();

  state.renderer.setBackground(0.055, 0.07, 0.085);
  return fullScreen;
}

async function main() {
  setStatus("Starting vtk.js…");
  setupVtk();
  await initSectionViewer();
  wireUi();

  const catRes = await fetch(`${DATA}/catalog.json`);
  if (!catRes.ok) {
    setStatus("catalog.json missing — run: npm run convert");
    return;
  }
  state.catalog = await catRes.json();
  state.origin = state.catalog.origin;
  state.zExag = +el.zExag.value;
  state.solidOpacity = +el.solidOpacity.value;

  const solids = state.catalog.solids || [];
  if (!solids.length) {
    setStatus("No solids in catalog — re-run npm run convert (VS* required)");
    return;
  }

  // 1) Load SOLIDS first — fundamental layer
  let i = 0;
  for (const solid of solids.sort((a, b) => a.ageOrder - b.ageOrder)) {
    i++;
    setStatus(`Loading SOLID ${i}/${solids.length}: ${solid.label}…`);
    try {
      await addMeshActor(solid);
    } catch (err) {
      console.error(solid.id, err);
    }
    if (i % 2 === 0) state.renderWindow.render();
  }
  state.renderer.resetCamera();
  syncInteractionCenter(state.interactorStyle);
  state.renderWindow.render();

  // 2) Faults (cut solids)
  const faults = state.catalog.surfaces.filter((s) => s.kind === "fault");
  i = 0;
  for (const f of faults) {
    i++;
    setStatus(`Loading faults ${i}/${faults.length}…`);
    try {
      await addMeshActor(f);
    } catch (err) {
      console.error(f.id, err);
    }
  }

  // 3) Topo
  const topo = state.catalog.surfaces.find((s) => s.kind === "topo");
  if (topo) {
    setStatus("Loading topography…");
    await addMeshActor(topo);
  }

  // 4) Contact horizons (optional, hidden by default)
  const horizons = state.catalog.surfaces.filter((s) => s.kind === "horizon");
  i = 0;
  for (const h of horizons) {
    i++;
    if (i % 4 === 0) setStatus(`Loading contacts ${i}/${horizons.length}…`);
    try {
      await addMeshActor(h);
    } catch (err) {
      console.error(h.id, err);
    }
  }

  rebuildWells();
  state.gravityRaw = await loadGravity();
  rebuildGravity();
  fillLists();

  state.renderer.resetCamera();
  syncInteractionCenter(state.interactorStyle);
  state.renderWindow.render();

  const tris = solids.reduce((a, s) => a + s.triangleCount, 0);
  el.pick.textContent = "";
  setStatus("");
  updateCompass();
  el.relationBox.innerHTML = `
    <strong>Solid model (required)</strong><br/>
    GoCAD <em>VS01–VS14</em> volumetric shells → vtk.js PolyData solids.<br/>
    <b>North:</b> ${NORTH.crs} · +Y = Grid North · Mag N = ${NORTH.gridMagneticAngleDeg.toFixed(2)}° east of grid.<br/>
    Voxel stair-steps removed with <em>Taubin Laplacian</em> smoothing.
  `;
}

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message || err}`);
});
