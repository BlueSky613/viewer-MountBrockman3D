# Mount Brockman Syncline — Solid 3D Viewer (vtk.js)

Geological **volume solids** are the core of this viewer. GoCAD `VS*` closed shells are converted to binary meshes and rendered as opaque **vtk.js PolyData** actors, colored from GeoModeller `ColorShading`.

## Quick start

```bash
cd viewer
npm install
npm run convert   # builds solids/ + surfaces/ from rawData (required once)
npm start         # http://localhost:5173
```

## Architecture

| Layer | Source | Role |
|-------|--------|------|
| **Solids (primary)** | GoCAD `VS01`–`VS14` | Closed volumetric shells → vtk.js solid bodies (Taubin-smoothed) |
| Faults | GoCAD `F*` | Cut solids (`InfluencedByFault` / `StopsOnFault`) |
| Contacts | GoCAD `S*` | Optional horizon surfaces (off by default) |
| Topo / wells / gravity | GoCAD Elevation, wells, gravity points | Context layers |
| Colors & relations | GeoModeller XML | Formation/fault RGB, stratigraphic pile |

Renderer: **@kitware/vtk.js** (Geometry profile).

## Convert output

- `public/data/solids/*.bin` — VS* solid meshes (MB3D binary)
- `public/data/surfaces/*.bin` — faults, contacts, topo
- `public/data/catalog.json` — colors, stratigraphy, fault network
