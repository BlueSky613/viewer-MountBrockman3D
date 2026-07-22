/**
 * Convert GoCAD + GeoModeller rawData → web-ready binary meshes + catalog.
 * Geometry: GoCAD TSurf / Wells / Gravity points
 * Colors & relationships: GeoModeller XML
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GOCAD = path.join(ROOT, "rawData/3D_Mount_Brockman_GOCAD");
const GM = path.join(ROOT, "rawData/3D_Mount_Brockman_GeoModeller");
const OUT = path.join(__dirname, "../public/data");
const SURF_OUT = path.join(OUT, "surfaces");
const SOLID_OUT = path.join(OUT, "solids");
const IMG_OUT = path.join(OUT, "images");

for (const d of [OUT, SURF_OUT, SOLID_OUT, IMG_OUT]) fs.mkdirSync(d, { recursive: true });

/** GoCAD long-name / file stem → GeoModeller code (+ geological metadata) */
const UNIT_MAP = {
  Kungarra_Formation: {
    code: "PLTUk",
    label: "Kungarra Formation",
    lithology: "Siltstone / sandstone (Turee Creek Group)",
    ageOrder: 1,
  },
  Boolgeeda_Iron_Formation: {
    code: "PLHo",
    label: "Boolgeeda Iron Formation",
    lithology: "Banded iron formation",
    ageOrder: 2,
  },
  Woongarra_Rhyolite: {
    code: "PLHw",
    label: "Woongarra Rhyolite",
    lithology: "Rhyolite / felsic volcanic",
    ageOrder: 3,
  },
  Weeli_Wolli_Formation: {
    code: "PLHj",
    label: "Weeli Wolli Formation",
    lithology: "BIF / jaspilite / shale",
    ageOrder: 4,
  },
  Joffre_Member: {
    code: "JOF",
    label: "Joffre Member",
    lithology: "Banded iron formation (Brockman IF)",
    ageOrder: 5,
  },
  Joffre_Member_4: {
    code: "JOF4",
    label: "Joffre Member (panel 4)",
    lithology: "Banded iron formation",
    ageOrder: 5.1,
  },
  Joffre_Member_3: {
    code: "JOF3",
    label: "Joffre Member (panel 3)",
    lithology: "Banded iron formation",
    ageOrder: 5.2,
  },
  Joffre_Member_2: {
    code: "JOF2",
    label: "Joffre Member (panel 2)",
    lithology: "Banded iron formation",
    ageOrder: 5.3,
  },
  Joffre_Member_1: {
    code: "JOF1",
    label: "Joffre Member (panel 1)",
    lithology: "Banded iron formation",
    ageOrder: 5.4,
  },
  Dolerite: {
    code: "DOL",
    label: "Dolerite",
    lithology: "Mafic intrusion / sill",
    ageOrder: 6,
  },
  Whaleback_Shale_Member: {
    code: "WS1",
    label: "Whaleback Shale Member",
    lithology: "Shale / siltstone",
    ageOrder: 7,
  },
  Whaleback_Shale_Member_2: {
    code: "WS2",
    label: "Whaleback Shale Member (panel 2)",
    lithology: "Shale / siltstone",
    ageOrder: 7.1,
  },
  Whaleback_Shale_Member_1: {
    code: "WS1",
    label: "Whaleback Shale Member (panel 1)",
    lithology: "Shale / siltstone",
    ageOrder: 7.2,
  },
  Dales_Gorge_Member: {
    code: "DG1",
    label: "Dales Gorge Member",
    lithology: "BIF / shale macrobands",
    ageOrder: 8,
  },
  Dales_Gorge_Member_3: {
    code: "DG3",
    label: "Dales Gorge Member (panel 3)",
    lithology: "BIF / shale macrobands",
    ageOrder: 8.1,
  },
  Dales_Gorge_Member_2: {
    code: "DG2",
    label: "Dales Gorge Member (panel 2)",
    lithology: "BIF / shale macrobands",
    ageOrder: 8.2,
  },
  Dales_Gorge_Member_1: {
    code: "DG1",
    label: "Dales Gorge Member (panel 1)",
    lithology: "BIF / shale macrobands",
    ageOrder: 8.3,
  },
  Brockman_Iron_Formation: {
    code: "PLHb",
    label: "Brockman Iron Formation",
    lithology: "Banded iron formation",
    ageOrder: 9,
  },
  McRae_Shale_Mt_Sylvia_Fmtn: {
    code: "AHs",
    label: "Mt McRae Shale / Mt Sylvia Fm",
    lithology: "Shale / BIF",
    ageOrder: 10,
  },
  Mt_McRae_Shale_Mt_Sylvia_Fm: {
    code: "AHs",
    label: "Mt McRae Shale / Mt Sylvia Fm",
    lithology: "Shale / BIF",
    ageOrder: 10,
  },
  Marra_Mamba_Iron_Formation: {
    code: "AHm",
    label: "Marra Mamba Iron Formation",
    lithology: "Banded iron formation",
    ageOrder: 11,
  },
  Jeerinah_Formation: {
    code: "AFj",
    label: "Jeerinah Formation",
    lithology: "Shale / chert / volcaniclastic (Fortescue)",
    ageOrder: 12,
  },
  Bunjinah_Formation: {
    code: "AFu",
    label: "Bunjinah Formation",
    lithology: "Basalt / volcanic (Fortescue)",
    ageOrder: 13,
  },
};

const FALLBACK_COLORS = {
  PLTUk: "#CDB6B5",
  PLHo: "#B1DFED",
  PLHw: "#BC8E8E",
  PLHj: "#CDB6B5",
  JOF: "#7967ED",
  JOF1: "#0000CD",
  JOF2: "#1C85ED",
  JOF3: "#0000CD",
  JOF4: "#00B1ED",
  DOL: "#006400",
  WS1: "#CDCD00",
  WS2: "#ED9A49",
  DG1: "#31CD31",
  DG2: "#BCED67",
  DG3: "#00FF00",
  PLHb: "#B1DFED",
  AHs: "#A52A2A",
  AHm: "#B1DFED",
  AFj: "#8A4689",
  AFu: "#CDB5CD",
  Cover: "#FFFF00",
  A1: "#FF0000",
  A2: "#FF0000",
  B1: "#FFA500",
  B2: "#FFA500",
  C1: "#8A8A00",
  C2: "#8A8A00",
  C3: "#8A8A00",
  C4: "#8A8A00",
  C5: "#8A8A00",
  C6: "#8A8A00",
  C7: "#8A8A00",
  D1: "#448A00",
  D2: "#448A00",
  D3: "#448A00",
  E1: "#00678A",
  E2: "#00678A",
  E3: "#00678A",
  E4: "#00678A",
};

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function parseGeoModellerXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, "utf8");
  const colors = { ...FALLBACK_COLORS };
  const stopsOn = {};
  let influenced = [];

  const formRe =
    /<geo:Formation Name="([^"]+)">[\s\S]*?<geo:ColorShading Blue="(\d+)" Green="(\d+)" Red="(\d+)"\/>/g;
  let m;
  while ((m = formRe.exec(xml))) {
    colors[m[1]] = rgbToHex(+m[4], +m[3], +m[2]);
  }

  const faultBlocks = xml.split(/<geo:Fault Name="/).slice(1);
  for (const block of faultBlocks) {
    const name = block.slice(0, block.indexOf('"'));
    const cm = block.match(
      /<geo:ColorShading Blue="(\d+)" Green="(\d+)" Red="(\d+)"\/>/
    );
    if (cm) colors[name] = rgbToHex(+cm[3], +cm[2], +cm[1]);
    const stops = [...block.matchAll(/<geo:StopsOnFault Name="([^"]+)"\/>/g)].map(
      (x) => x[1]
    );
    if (stops.length) stopsOn[name] = stops;
  }

  const seriesMatch = xml.match(
    /<geo:Series[^>]*name="Folded_Series"[^>]*>([\s\S]*?)<\/geo:Series>/
  );
  let stratPile = [];
  if (seriesMatch) {
    stratPile = [...seriesMatch[1].matchAll(/<geo:Data Name="([^"]+)"\/>/g)].map(
      (x) => x[1]
    );
    influenced = [
      ...new Set(
        [...seriesMatch[1].matchAll(/<geo:InfluencedByFault Name="([^"]+)"\/>/g)].map(
          (x) => x[1]
        )
      ),
    ];
  }

  const extent = {};
  const ext = xml.match(
    /Xmin="([^"]+)"[\s\S]*?Xmax="([^"]+)"[\s\S]*?Ymin="([^"]+)"[\s\S]*?Ymax="([^"]+)"[\s\S]*?Zmin="([^"]+)"[\s\S]*?Zmax="([^"]+)"/
  );
  if (ext) {
    extent.xmin = +ext[1];
    extent.xmax = +ext[2];
    extent.ymin = +ext[3];
    extent.ymax = +ext[4];
    extent.zmin = +ext[5];
    extent.zmax = +ext[6];
  }

  return { colors, stopsOn, influenced, stratPile, extent };
}

function parseColor(headerText) {
  const hex = headerText.match(/\*solid\*color:\s*(#[0-9a-fA-F]{6})/);
  if (hex) return hex[1].toUpperCase();
  const rgba = headerText.match(
    /\*solid\*color:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/
  );
  if (rgba) {
    return rgbToHex(
      Math.round(+rgba[1] * 255),
      Math.round(+rgba[2] * 255),
      Math.round(+rgba[3] * 255)
    );
  }
  return null;
}

function parseTSurf(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const headerEnd = text.indexOf("TFACE");
  const header = headerEnd >= 0 ? text.slice(0, headerEnd) : text.slice(0, 2000);
  const nameMatch = header.match(/name:\s*(.+)/);
  const name = nameMatch ? nameMatch[1].trim() : path.basename(filePath, ".ts");
  const gocadColor = parseColor(header);

  const verts = new Map();
  const tris = [];
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  const atoms = new Map(); // atomId → refId
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("VRTX ") || line.startsWith("PVRTX ")) {
      const p = line.trim().split(/\s+/);
      const id = +p[1];
      const x = +p[2],
        y = +p[3],
        z = +p[4];
      verts.set(id, [x, y, z]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    } else if (line.startsWith("ATOM ")) {
      // ATOM id refId — alias to an existing vertex
      const p = line.trim().split(/\s+/);
      atoms.set(+p[1], +p[2]);
    } else if (line.startsWith("TRGL ")) {
      const p = line.trim().split(/\s+/);
      tris.push(+p[1], +p[2], +p[3]);
    }
  }

  function resolveId(id, depth = 0) {
    if (verts.has(id)) return id;
    if (atoms.has(id) && depth < 32) return resolveId(atoms.get(id), depth + 1);
    return null;
  }

  const ids = [...verts.keys()].sort((a, b) => a - b);
  const idToIndex = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array(ids.length * 3);
  ids.forEach((id, i) => {
    const [x, y, z] = verts.get(id);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });
  const indices = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const resolved = resolveId(tris[i]);
    const idx = resolved === null ? undefined : idToIndex.get(resolved);
    if (idx === undefined) throw new Error(`Missing vertex ${tris[i]} in ${filePath}`);
    indices[i] = idx;
  }

  return {
    name,
    gocadColor,
    positions,
    indices,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    vertexCount: ids.length,
    triangleCount: tris.length / 3,
  };
}

function writeMeshBin(outPath, positions, indices) {
  const header = Buffer.alloc(16);
  header.write("MB3D", 0, "ascii");
  header.writeUInt32LE(positions.length / 3, 4);
  header.writeUInt32LE(indices.length / 3, 8);
  header.writeUInt32LE(1, 12); // version
  const posBuf = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const idxBuf = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  fs.writeFileSync(outPath, Buffer.concat([header, posBuf, idxBuf]));
}

/**
 * Taubin (non-shrinking) Laplacian smoothing — removes 50m×50m×2.5m
 * voxel stair-steps on VS* isosurface solids while limiting volume collapse.
 */
function buildAdjacency(nVerts, indices) {
  const neigh = Array.from({ length: nVerts }, () => []);
  const pushUnique = (i, j) => {
    const list = neigh[i];
    for (let k = 0; k < list.length; k++) if (list[k] === j) return;
    list.push(j);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    pushUnique(a, b);
    pushUnique(b, a);
    pushUnique(a, c);
    pushUnique(c, a);
    pushUnique(b, c);
    pushUnique(c, b);
  }
  return neigh;
}

function laplacianStep(src, dst, neigh, factor) {
  const n = src.length / 3;
  for (let i = 0; i < n; i++) {
    const nbrs = neigh[i];
    const i3 = i * 3;
    if (!nbrs.length) {
      dst[i3] = src[i3];
      dst[i3 + 1] = src[i3 + 1];
      dst[i3 + 2] = src[i3 + 2];
      continue;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < nbrs.length; k++) {
      const j3 = nbrs[k] * 3;
      sx += src[j3];
      sy += src[j3 + 1];
      sz += src[j3 + 2];
    }
    const inv = 1 / nbrs.length;
    const ax = sx * inv;
    const ay = sy * inv;
    const az = sz * inv;
    dst[i3] = src[i3] + factor * (ax - src[i3]);
    dst[i3 + 1] = src[i3 + 1] + factor * (ay - src[i3 + 1]);
    dst[i3 + 2] = src[i3 + 2] + factor * (az - src[i3 + 2]);
  }
}

function taubinSmooth(positions, indices, opts = {}) {
  const iterations = opts.iterations ?? 35;
  const lambda = opts.lambda ?? 0.63;
  const mu = opts.mu ?? -0.67;
  const nVerts = positions.length / 3;
  const neigh = buildAdjacency(nVerts, indices);
  let src = positions.slice();
  let dst = new Float32Array(positions.length);
  for (let it = 0; it < iterations; it++) {
    laplacianStep(src, dst, neigh, lambda);
    laplacianStep(dst, src, neigh, mu);
  }
  return src;
}

function boundsFromPositions(positions) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function classifySurface(fileName) {
  if (fileName === "Elevation.ts") return { kind: "topo", group: "topography" };
  if (fileName === "Geology.ts") return { kind: "topo_map", group: "topography" };
  if (fileName.startsWith("F")) return { kind: "fault", group: "faults" };
  if (fileName.startsWith("VS")) return { kind: "volume", group: "volumes" };
  if (fileName.startsWith("S")) return { kind: "horizon", group: "horizons" };
  return { kind: "other", group: "other" };
}

function unitKeyFromFile(fileName) {
  // S01_Kungarra_Formation.ts → Kungarra_Formation
  // F01_Fault A1.ts → A1
  // VS10_Brockman_Iron_Formation.ts → Brockman_Iron_Formation
  const base = fileName.replace(/\.ts$/, "");
  const fault = base.match(/^F\d+_Fault\s+(.+)$/);
  if (fault) return { faultCode: fault[1].trim() };
  const s = base.match(/^(?:S\d+[a-z]?_|VS\d+_)(.+)$/);
  if (s) return { unitKey: s[1] };
  return { unitKey: base };
}

function parseWell(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const name = (text.match(/name:\s*(.+)/) || [])[1]?.trim() || path.basename(filePath, ".wl");
  const wref = text.match(/WREF\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  const stations = [...text.matchAll(/STATION\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)].map(
    (m) => ({ md: +m[1], az: +m[2], incl: +m[3] })
  );
  const markers = [
    ...text.matchAll(/MRKR\s+(\S+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g),
  ].map((m) => ({ name: m[1], az: +m[2], md: +m[3] }));

  if (!wref) return null;
  const x0 = +wref[1],
    y0 = +wref[2],
    z0 = +wref[3];

  // Vertical / MD-style path from stations (these wells are vertical: az=0,incl=0)
  const pathPts = [];
  if (stations.length === 0) {
    pathPts.push([x0, y0, z0], [x0, y0, z0 - 100]);
  } else {
    for (const s of stations) {
      pathPts.push([x0, y0, z0 - s.md]);
    }
  }

  return { name, collar: [x0, y0, z0], path: pathPts, markers };
}

function parseGravity(filePath, stride = 8) {
  const text = fs.readFileSync(filePath, "utf8");
  const pts = [];
  let minR = Infinity,
    maxR = -Infinity;
  const lines = text.split(/\r?\n/);
  let n = 0;
  for (const line of lines) {
    if (!line.startsWith("PVRTX ")) continue;
    if (n++ % stride !== 0) continue;
    const p = line.trim().split(/\s+/);
    const x = +p[2],
      y = +p[3],
      z = +p[4];
    const residual = +p[7];
    pts.push(x, y, z, residual);
    if (residual < minR) minR = residual;
    if (residual > maxR) maxR = residual;
  }
  return { positions: pts, residualRange: [minR, maxR], count: pts.length / 4, stride };
}

function parseVoxetMeta(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const name = (text.match(/name:\s*(.+)/) || [])[1]?.trim();
  const o = text.match(/AXIS_O\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  const u = text.match(/AXIS_U\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  const v = text.match(/AXIS_V\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  const w = text.match(/AXIS_W\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  const n = text.match(/AXIS_N\s+(\d+)\s+(\d+)\s+(\d+)/);
  const regionColors = {};
  for (const m of text.matchAll(
    /\*regions\*([^*]+)\*solid\*color:\s*(#[0-9a-fA-F]{6})/g
  )) {
    regionColors[m[1]] = m[2].toUpperCase();
  }
  return {
    name,
    origin: o ? [+o[1], +o[2], +o[3]] : null,
    axisU: u ? [+u[1], +u[2], +u[3]] : null,
    axisV: v ? [+v[1], +v[2], +v[3]] : null,
    axisW: w ? [+w[1], +w[2], +w[3]] : null,
    dims: n ? [+n[1], +n[2], +n[3]] : null,
    regionColors,
  };
}

// ── main ──────────────────────────────────────────────────────────
console.log("Parsing GeoModeller XML…");
const gm = parseGeoModellerXml(path.join(GM, "MtBrockmanSyncline.xml"));

const surfDir = path.join(GOCAD, "SURFACES");
const files = fs.readdirSync(surfDir).filter((f) => f.endsWith(".ts"));

// Geology.ts omitted (duplicate of Elevation). VS* solids are PRIMARY and required.
const convertFiles = files.filter((f) => f !== "Geology.ts");
const solidFiles = convertFiles.filter((f) => f.startsWith("VS"));
const surfaceFiles = convertFiles.filter((f) => !f.startsWith("VS"));

console.log(
  `Converting ${solidFiles.length} SOLID shells (VS*) + ${surfaceFiles.length} surfaces…`
);

const solids = [];
const surfaces = [];
let globalMin = [Infinity, Infinity, Infinity];
let globalMax = [-Infinity, -Infinity, -Infinity];

function convertOne(file, { isSolid }) {
  const full = path.join(surfDir, file);
  process.stdout.write(`  ${isSolid ? "[SOLID] " : ""}${file}… `);
  const mesh = parseTSurf(full);
  const cls = classifySurface(file);
  const keys = unitKeyFromFile(file);

  let code = null;
  let meta = null;
  let color = mesh.gocadColor;

  if (keys.faultCode) {
    code = keys.faultCode;
    color = gm.colors[code] || mesh.gocadColor || FALLBACK_COLORS[code];
    meta = {
      label: `Fault ${code}`,
      lithology: "Structural discontinuity",
      stopsOn: gm.stopsOn[code] || [],
      cutsFormations: gm.stratPile.length ? gm.stratPile.slice() : ["Folded_Series (all)"],
    };
  } else if (keys.unitKey && UNIT_MAP[keys.unitKey]) {
    meta = UNIT_MAP[keys.unitKey];
    code = meta.code;
    color = gm.colors[code] || mesh.gocadColor || FALLBACK_COLORS[code];
  } else if (cls.kind === "topo") {
    code = "TOPO";
    color = "#5A8A56";
    meta = { label: "Topography (DTM)", lithology: "Elevation surface", ageOrder: 0 };
  }

  // Smooth voxel stair-steps on VS* solids (50m×50m×2.5m grid isosurfaces)
  let positions = mesh.positions;
  let bounds = mesh.bounds;
  let smoothed = false;
  if (isSolid) {
    const t0 = Date.now();
    positions = taubinSmooth(positions, mesh.indices, {
      iterations: 40,
      lambda: 0.63,
      mu: -0.67,
    });
    bounds = boundsFromPositions(positions);
    smoothed = true;
    process.stdout.write(`smooth ${Date.now() - t0}ms… `);
  }

  const stem = file.replace(/\.ts$/, "").replace(/\s+/g, "_");
  const binName = `${stem}.bin`;
  const outDir = isSolid ? SOLID_OUT : SURF_OUT;
  const relDir = isSolid ? "solids" : "surfaces";
  writeMeshBin(path.join(outDir, binName), positions, mesh.indices);

  for (let i = 0; i < 3; i++) {
    globalMin[i] = Math.min(globalMin[i], bounds.min[i]);
    globalMax[i] = Math.max(globalMax[i], bounds.max[i]);
  }

  const entry = {
    id: stem,
    file: `${relDir}/${binName}`,
    sourceFile: file,
    kind: isSolid ? "solid" : cls.kind,
    group: isSolid ? "solids" : cls.group,
    name: mesh.name,
    code,
    color,
    gocadColor: mesh.gocadColor,
    label: meta?.label || mesh.name,
    lithology: meta?.lithology || "",
    ageOrder: meta?.ageOrder ?? 99,
    stopsOn: meta?.stopsOn || [],
    cutsFormations: meta?.cutsFormations || null,
    faultedBy:
      isSolid || cls.kind === "horizon"
        ? gm.influenced.slice()
        : [],
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    bounds,
    defaultVisible: isSolid
      ? true
      : cls.kind === "fault" || cls.kind === "topo",
    defaultOpacity: isSolid
      ? 1.0
      : cls.kind === "fault"
        ? 0.75
        : cls.kind === "topo"
          ? 0.35
          : 0.55,
    solid: isSolid,
    smoothed,
    smoothMethod: smoothed ? "taubin-laplacian" : null,
  };

  if (isSolid) solids.push(entry);
  else surfaces.push(entry);
  console.log(`${mesh.vertexCount}v / ${mesh.triangleCount}t`);
}

// Solids first — they define the model
for (const file of solidFiles.sort()) convertOne(file, { isSolid: true });
for (const file of surfaceFiles.sort()) convertOne(file, { isSolid: false });

console.log("Parsing wells…");
const wellDir = path.join(GOCAD, "WELLS");
const wells = fs
  .readdirSync(wellDir)
  .filter((f) => f.endsWith(".wl"))
  .map((f) => parseWell(path.join(wellDir, f)))
  .filter(Boolean);

console.log("Parsing gravity points (stride 10)…");
const gravity = parseGravity(path.join(GOCAD, "POINTSSET/Gravity_modelling.vs"), 10);

console.log("Reading voxet metadata…");
const voxets = ["VOI.vo", "Gravity.vo", "TMI.vo"].map((f) =>
  parseVoxetMeta(path.join(GOCAD, "VOXETS", f))
);

// Copy map images for overlay panel
const imgSrc = path.join(GOCAD, "IMAGES");
if (fs.existsSync(imgSrc)) {
  for (const f of fs.readdirSync(imgSrc)) {
    fs.copyFileSync(path.join(imgSrc, f), path.join(IMG_OUT, f));
  }
}

const origin = [
  (globalMin[0] + globalMax[0]) / 2,
  (globalMin[1] + globalMax[1]) / 2,
  (globalMin[2] + globalMax[2]) / 2,
];

// Lithology ↔ fault matrix (all Folded_Series units cut by all faults)
const lithologyFaultMatrix = {};
for (const code of gm.stratPile) {
  lithologyFaultMatrix[code] = gm.influenced.slice();
}

const catalog = {
  project: "Mount Brockman Syncline",
  crs: "GDA94 / MGA Zone 50 (EPSG:28350) — local metres, Z = elevation",
  sources: {
    solids: "GoCAD VS* volumetric shells → vtk.js PolyData actors (PRIMARY)",
    geometry: "GoCAD S*/F*/Elevation TSurf / Wells / Gravity points",
    colors: "GeoModeller MtBrockmanSyncline.xml ColorShading",
    relationships: "GeoModeller stratigraphic pile + InfluencedByFault + StopsOnFault",
    renderer: "vtk.js (@kitware/vtk.js) Geometry profile",
  },
  origin,
  bounds: { min: globalMin, max: globalMax },
  geomodellerExtent: gm.extent,
  colors: gm.colors,
  stratigraphy: {
    // Geological young → old (GoCAD S01→S13). GeoModeller Folded_Series list is oldest→youngest.
    youngToOld: [
      "PLTUk",
      "PLHo",
      "PLHw",
      "PLHj",
      "JOF",
      "DOL",
      "JOF4",
      "JOF3",
      "JOF2",
      "JOF1",
      "WS2",
      "WS1",
      "DG3",
      "DG2",
      "DG1",
      "PLHb",
      "AHs",
      "AHm",
      "AFj",
      "AFu",
    ],
    geomodellerPileOldestFirst: gm.stratPile,
    series: [
      { name: "AFu_Series", relation: "erode", formations: ["AFu"], faulted: false },
      {
        name: "Folded_Series",
        relation: "erode",
        formations: gm.stratPile,
        faulted: true,
        influencedByFaults: gm.influenced,
      },
    ],
    notes: [
      "Younger units overlie older units within the syncline.",
      "Dolerite (DOL) is a sill intercalated in the Joffre stack.",
      "S07–S09 GoCAD panels are fault-split patches of the same stratigraphic unit.",
    ],
  },
  faultNetwork: {
    stopsOn: gm.stopsOn,
    throughGoing: gm.influenced.filter((f) => !gm.stopsOn[f]),
    rule: "Shorter/younger faults terminate against StopsOnFault parents; through-going faults have no stop.",
  },
  lithologyFaultRelations: {
    rule: "Every formation in Folded_Series is cut by all 17 faults (InfluencedByFault).",
    matrix: lithologyFaultMatrix,
    wellLithologyCodes: [
      "00_Cover",
      "01_Kungarra_formation",
      "02_Boolgeeda_Iron_Formation",
      "03_Woongarra_Rhyolite",
      "06_Dolerite",
      "10_Brockman_Iron_Formation",
      "11_Mt_McRae_Shale_Mt_Sylvia_Fmtn",
      "12_Marra_Mamba_Iron_Formation",
    ],
  },
  overlayPolicy: {
    primary: "VS* closed volumetric shells rendered as opaque solids in vtk.js",
    stairStepFix:
      "VS* vertices sit on 50m×50m×2.5m voxel grid; Taubin Laplacian smoothing (40 iter) applied at convert",
    skipDuplicateTopo: "Geology.ts omitted — identical mesh to Elevation.ts",
    contacts: "S* horizons optional (off by default) — contacts duplicate solid boundaries",
    zFighting: "topo translucent; faults translucent over solids; solid opacity = 1",
    mapOverlays: [
      "Geology_map.jpg",
      "Aerial_photo.jpg",
      "Gravity_image.jpg",
      "Magnetic_image.jpg",
      "Mineralization_map.jpg",
      "Radiometrics_K_Th_U.jpg",
      "Section_7400W.jpg",
    ],
  },
  unitMap: UNIT_MAP,
  solids,
  surfaces,
  wells,
  gravity: {
    file: "gravity.bin",
    count: gravity.count,
    residualRange: gravity.residualRange,
    stride: gravity.stride,
  },
  voxets,
  images: fs.existsSync(IMG_OUT)
    ? fs.readdirSync(IMG_OUT).map((f) => `images/${f}`)
    : [],
};

// Write gravity binary: interleaved x,y,z,residual as Float32
{
  const arr = new Float32Array(gravity.positions);
  const buf = Buffer.from(arr.buffer);
  const hdr = Buffer.alloc(8);
  hdr.write("MBGR", 0, "ascii");
  hdr.writeUInt32LE(gravity.count, 4);
  fs.writeFileSync(path.join(OUT, "gravity.bin"), Buffer.concat([hdr, buf]));
}

fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(catalog, null, 2));
fs.writeFileSync(path.join(OUT, "wells.json"), JSON.stringify(wells));

const solidTris = solids.reduce((a, s) => a + s.triangleCount, 0);
console.log("\nDone.");
console.log(`  SOLIDS (VS*): ${solids.length}  (${solidTris.toLocaleString()} triangles)`);
console.log(`  Surfaces: ${surfaces.length}`);
console.log(`  Wells: ${wells.length}`);
console.log(`  Gravity samples: ${gravity.count}`);
console.log(`  Origin: ${origin.map((v) => v.toFixed(1)).join(", ")}`);
console.log(`  Output: ${OUT}`);
