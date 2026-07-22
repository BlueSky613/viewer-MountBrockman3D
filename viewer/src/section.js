/**
 * Geologic cross-section in the 3D scene.
 * Loads precomputed section JSON and places lithology faces / fault traces
 * on the section plane at the correct model coordinates (no modal / 2D overlay).
 */
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkPoints from "@kitware/vtk.js/Common/Core/Points";
import vtkCellArray from "@kitware/vtk.js/Common/Core/CellArray";
import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane";

const DATA_URL = "/data/sections";

function hexToRgb01(hex) {
  const h = (hex || "#888888").replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Section (u,v) → world (E,N,Z) on the cut plane. */
function uvToWorld(u, v, axis, position) {
  if (axis === "x") return [position, u, v];
  if (axis === "y") return [u, position, v];
  return [u, v, position];
}

function worldToScene(E, N, Z, origin, zExag) {
  return [E - origin[0], N - origin[1], (Z - origin[2]) * zExag];
}

function meshToSceneXYZ(mesh, axis, position, origin, zExag, normalOffset = 0) {
  if (!mesh?.vertices?.length || !mesh?.triangles?.length) return null;
  const V = mesh.vertices;
  const n = V.length / 2;
  const xyz = new Float32Array(n * 3);
  const off =
    axis === "x" ? [normalOffset, 0, 0] : axis === "y" ? [0, normalOffset, 0] : [0, 0, normalOffset];
  for (let i = 0; i < n; i++) {
    const [E, N, Z] = uvToWorld(V[i * 2], V[i * 2 + 1], axis, position);
    const p = worldToScene(E, N, Z, origin, zExag);
    xyz[i * 3] = p[0] + off[0];
    xyz[i * 3 + 1] = p[1] + off[1];
    xyz[i * 3 + 2] = p[2] + off[2];
  }
  const T = mesh.triangles;
  const nTris = Math.floor(T.length / 3);
  const cells = new Uint32Array(nTris * 4);
  for (let t = 0; t < nTris; t++) {
    const o = t * 4;
    const i = t * 3;
    cells[o] = 3;
    cells[o + 1] = T[i];
    cells[o + 2] = T[i + 1];
    cells[o + 3] = T[i + 2];
  }
  const points = vtkPoints.newInstance();
  points.setData(xyz, 3);
  const polys = vtkCellArray.newInstance();
  polys.setData(cells);
  const pd = vtkPolyData.newInstance();
  pd.setPoints(points);
  pd.setPolys(polys);
  return pd;
}

function polylinesToSceneXYZ(polylines, axis, position, origin, zExag) {
  if (!polylines?.length) return null;
  const pts = [];
  const lines = [];
  for (const pl of polylines) {
    const p = pl.points;
    if (!p || p.length < 4) continue;
    const start = pts.length / 3;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const [E, N, Z] = uvToWorld(p[i * 2], p[i * 2 + 1], axis, position);
      const s = worldToScene(E, N, Z, origin, zExag);
      pts.push(s[0], s[1], s[2]);
    }
    lines.push(n);
    for (let i = 0; i < n; i++) lines.push(start + i);
  }
  if (!pts.length) return null;
  const points = vtkPoints.newInstance();
  points.setData(Float32Array.from(pts), 3);
  const lineCells = vtkCellArray.newInstance();
  lineCells.setData(Uint32Array.from(lines));
  const pd = vtkPolyData.newInstance();
  pd.setPoints(points);
  pd.setLines(lineCells);
  return pd;
}

function planeNormalForAxis(axis, keepPositiveSide) {
  const s = keepPositiveSide ? 1 : -1;
  if (axis === "x") return [s, 0, 0];
  if (axis === "y") return [0, s, 0];
  return [0, 0, s];
}

/**
 * @param {{
 *   renderer: any,
 *   renderWindow: any,
 *   getOrigin: () => number[],
 *   getZExag: () => number,
 *   getEntries: () => Iterable<any>,
 *   statusEl?: HTMLElement | null,
 * }} opts
 */
export function createSectionViewer(opts) {
  const { renderer, renderWindow, getOrigin, getZExag, getEntries, statusEl } = opts;
  let index = null;
  const cache = new Map();
  let currentId = null;
  let enabled = false;
  let options = {
    fill: true,
    patch: true,
    contacts: true,
    faults: true,
    topo: true,
    /** If true, hide all solids; if false (default), keep the back half and clip away the front. */
    hideVolumes: false,
    clipVolumes: true,
  };
  const actors = [];
  const clipPlane = vtkPlane.newInstance();
  let clippingActive = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function clearActors() {
    for (const a of actors) {
      renderer.removeActor(a);
      a.delete();
    }
    actors.length = 0;
  }

  function addSurfaceActor(pd, colorHex, opacity = 1) {
    if (!pd) return;
    const mapper = vtkMapper.newInstance({ scalarVisibility: false });
    mapper.setInputData(pd);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    const [r, g, b] = hexToRgb01(colorHex);
    const prop = actor.getProperty();
    prop.setColor(r, g, b);
    prop.setOpacity(opacity);
    prop.setLighting(true);
    prop.setAmbient(0.45);
    prop.setDiffuse(0.7);
    prop.setSpecular(0.05);
    prop.setRepresentationToSurface();
    prop.setEdgeVisibility(false);
    prop.setBackfaceCulling(false);
    actor.setVisibility(true);
    renderer.addActor(actor);
    actors.push(actor);
  }

  function addLineActor(pd, colorHex, width = 2) {
    if (!pd) return;
    const mapper = vtkMapper.newInstance({ scalarVisibility: false });
    mapper.setInputData(pd);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    const [r, g, b] = hexToRgb01(colorHex);
    const prop = actor.getProperty();
    prop.setColor(r, g, b);
    prop.setOpacity(1);
    prop.setLineWidth(width);
    prop.setRepresentationToWireframe();
    prop.setLighting(false);
    actor.setVisibility(true);
    renderer.addActor(actor);
    actors.push(actor);
  }

  function clearClipping() {
    if (!clippingActive) return;
    for (const e of getEntries()) {
      const mapper = e.mapper;
      if (!mapper?.removeAllClippingPlanes) continue;
      mapper.removeAllClippingPlanes();
    }
    clippingActive = false;
  }

  /**
   * Clip solids so the camera-side (front) half is removed and the far (back) half remains.
   * Camera is framed on the +axis side of the plane, so we keep the −axis side.
   */
  function applyClipping(axis, positionScene) {
    clearClipping();
    if (!options.clipVolumes || options.hideVolumes) return;
    // VTK removes points with (x − o)·n < 0. Normal toward −axis ⇒ keep back, clip front.
    const n = planeNormalForAxis(axis, false);
    clipPlane.setOrigin(positionScene[0], positionScene[1], positionScene[2]);
    clipPlane.setNormal(n[0], n[1], n[2]);
    for (const e of getEntries()) {
      // Solids and faults: keep only the half behind the cut plane.
      if (e.meta.kind !== "solid" && e.meta.kind !== "fault") continue;
      e.mapper?.addClippingPlane?.(clipPlane);
    }
    clippingActive = true;
  }

  function setVolumeVisibilityForSection(on) {
    for (const e of getEntries()) {
      if (e.meta.kind !== "solid" && e.meta.kind !== "fault") continue;
      if (on && options.hideVolumes) {
        e.actor.setVisibility(false);
      } else {
        const row = document.querySelector(`.layer-item[data-id="${e.meta.id}"] input`);
        e.actor.setVisibility(row ? row.checked : e.meta.defaultVisible !== false);
      }
    }
  }

  async function loadIndex() {
    const res = await fetch(`${DATA_URL}/sections.json`);
    if (!res.ok) throw new Error(`sections.json not found (${res.status})`);
    index = await res.json();
    if (!currentId && index.sections?.length) currentId = index.sections[0].id;
    return index;
  }

  async function loadSection(id) {
    if (cache.has(id)) return cache.get(id);
    const meta = index.sections.find((s) => s.id === id);
    if (!meta) throw new Error(`Unknown section ${id}`);
    const res = await fetch(`${DATA_URL}/${meta.file}`);
    if (!res.ok) throw new Error(`Failed to load ${meta.file}`);
    const data = await res.json();
    cache.set(id, data);
    return data;
  }

  function getIndex() {
    return index;
  }

  function getCurrentId() {
    return currentId;
  }

  function setOptions(partial, { rebuild = true } = {}) {
    options = { ...options, ...partial };
    if (rebuild && enabled && currentId && cache.has(currentId)) {
      buildScene(cache.get(currentId));
    }
  }

  function getOptions() {
    return { ...options };
  }

  async function select(id) {
    currentId = id;
    if (enabled) await show(id);
  }

  function frameCameraOnSection(data, origin, zExag) {
    const cam = renderer.getActiveCamera();
    if (!cam) return;
    const { axis, position, bounds2d } = data;
    const uMid = (bounds2d.min[0] + bounds2d.max[0]) * 0.5;
    const vMid = (bounds2d.min[1] + bounds2d.max[1]) * 0.5;
    const [E, N, Z] = uvToWorld(uMid, vMid, axis, position);
    const focus = worldToScene(E, N, Z, origin, zExag);
    const span = Math.max(
      bounds2d.max[0] - bounds2d.min[0],
      (bounds2d.max[1] - bounds2d.min[1]) * zExag
    );
    const dist = Math.max(span * 0.85, 2000);
    let position3;
    if (axis === "x") position3 = [focus[0] + dist, focus[1], focus[2]];
    else if (axis === "y") position3 = [focus[0], focus[1] + dist, focus[2]];
    else position3 = [focus[0], focus[1], focus[2] + dist];
    cam.setFocalPoint(focus[0], focus[1], focus[2]);
    cam.setPosition(position3[0], position3[1], position3[2]);
    if (axis === "z") cam.setViewUp(0, 1, 0);
    else cam.setViewUp(0, 0, 1);
    renderer.resetCameraClippingRange();
  }

  function buildScene(data, { frameCamera = false } = {}) {
    clearActors();
    const origin = getOrigin();
    const zExag = getZExag();
    const { axis, position } = data;
    const planeOrigin = (() => {
      if (axis === "x") return worldToScene(position, origin[1], origin[2], origin, zExag);
      if (axis === "y") return worldToScene(origin[0], position, origin[2], origin, zExag);
      return worldToScene(origin[0], origin[1], position, origin, zExag);
    })();

    // Slight offset along plane normal avoids z-fighting with clipped shells.
    const faceOff = 1.5;
    if (options.fill) {
      for (const layer of data.layers) {
        const pd = meshToSceneXYZ(layer.fill, axis, position, origin, zExag, faceOff);
        addSurfaceActor(pd, layer.color, 1);
        if (options.patch && layer.patch) {
          const ppd = meshToSceneXYZ(layer.patch, axis, position, origin, zExag, faceOff);
          addSurfaceActor(ppd, layer.color, 1);
        }
      }
    }

    if (options.contacts) {
      for (const layer of data.layers) {
        const pd = polylinesToSceneXYZ(layer.polylines, axis, position, origin, zExag);
        addLineActor(pd, "#1a1a1a", 1.2);
      }
    }

    if (options.faults) {
      for (const f of data.faults) {
        const pd = polylinesToSceneXYZ(f.polylines, axis, position, origin, zExag);
        addLineActor(pd, f.color || "#c0392b", 3);
      }
    }

    if (options.topo && data.topography) {
      const pd = polylinesToSceneXYZ(
        data.topography.polylines,
        axis,
        position,
        origin,
        zExag
      );
      addLineActor(pd, "#111111", 2.5);
    }

    setVolumeVisibilityForSection(true);
    if (options.hideVolumes) {
      clearClipping();
    } else {
      // Keep solid behind the cut; remove only the front half toward the camera.
      applyClipping(axis, planeOrigin);
    }

    if (frameCamera) frameCameraOnSection(data, origin, zExag);
    renderWindow.render();
  }

  async function show(id = currentId) {
    enabled = true;
    currentId = id || currentId;
    if (!index) await loadIndex();
    if (!currentId) {
      setStatus("No sections in index");
      return;
    }
    setStatus(`Loading ${currentId}…`);
    const data = await loadSection(currentId);
    buildScene(data, { frameCamera: true });
    const meta = index.sections.find((s) => s.id === currentId);
    setStatus(
      `${meta?.name || currentId} · on cut plane · ${data.layers.length} units · ${data.faults.length} faults`
    );
  }

  function hide() {
    enabled = false;
    clearActors();
    clearClipping();
    setVolumeVisibilityForSection(false);
    renderWindow.render();
    setStatus("Off");
  }

  function isEnabled() {
    return enabled;
  }

  /** Rebuild section geometry after Z-exaggeration / origin changes. */
  function rebuild() {
    if (!enabled || !currentId || !cache.has(currentId)) return;
    buildScene(cache.get(currentId));
  }

  return {
    loadIndex,
    getIndex,
    getCurrentId,
    select,
    show,
    hide,
    isEnabled,
    setOptions,
    getOptions,
    rebuild,
  };
}
