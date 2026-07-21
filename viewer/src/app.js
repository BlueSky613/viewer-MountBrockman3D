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

const DATA = "/data";

const state = {
  catalog: null,
  actors: new Map(), // id → { actor, mapper, polydata, meta, rawPositions, rawIndices }
  origin: [0, 0, 0],
  zExag: 1.2,
  solidOpacity: 1.0,
  selectedId: null,
  gravityRaw: null,
  renderer: null,
  renderWindow: null,
  interactor: null,
};

const el = {
  status: document.getElementById("status"),
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
};

function setStatus(msg) {
  el.status.textContent = msg;
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
  state.renderWindow.render();
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

function selectLayer(id) {
  state.selectedId = id;
  document.querySelectorAll(".layer-item").forEach((n) => {
    n.classList.toggle("selected", n.dataset.id === id);
  });

  const entry = state.actors.get(id);
  if (!entry) return;
  const meta = entry.meta;

  for (const [mid, e] of state.actors) {
    const prop = e.actor.getProperty();
    if (mid === id) {
      prop.setAmbient(0.45);
      prop.setSpecular(0.4);
    } else {
      prop.setAmbient(meta.kind === "solid" ? 0.22 : 0.22);
      prop.setSpecular(e.meta.kind === "fault" ? 0.35 : 0.18);
    }
  }
  state.renderWindow.render();

  el.pick.textContent = `${meta.label}  [${meta.code || "—"}]\n${meta.lithology || meta.kind}\n${meta.triangleCount.toLocaleString()} triangles · vtk.js solid=${meta.solid ? "yes" : "no"}`;
  el.relationBox.innerHTML = renderRelations(meta);
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

  state.renderer.setBackground(0.055, 0.07, 0.085);
  return fullScreen;
}

async function main() {
  setStatus("Starting vtk.js…");
  setupVtk();
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
  state.renderWindow.render();

  const tris = solids.reduce((a, s) => a + s.triangleCount, 0);
  setStatus(
    `${state.catalog.project} · ${solids.length} SOLIDS (${tris.toLocaleString()} tris) · vtk.js · GeoModeller colors`
  );
  el.relationBox.innerHTML = `
    <strong>Solid model (required)</strong><br/>
    GoCAD <em>VS01–VS14</em> volumetric shells rendered as vtk.js PolyData solids.<br/>
    Colors from GeoModeller. Faults A1–E4 cut all Folded_Series solids.<br/>
    Contact <em>S*</em> surfaces optional; solids are the geological body.
  `;
}

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message || err}`);
});
