// Constantes do campus (mesmo bounding box do IFrota.py)
export const SW = [-22.5225, -43.9960];     // [lat, lon]
export const NE = [-22.5175, -43.9890];     // [lat, lon]
export const CENTRO = [
  (SW[1] + NE[1]) / 2,    // lon
  (SW[0] + NE[0]) / 2,    // lat
];
export const ZOOM_PADRAO = 17;

export const STYLE_LIGHT_URL = "https://tiles.openfreemap.org/styles/positron";
export const STYLE_DARK_URL = "./data/style-dark.json";

export const COR_HEX = {
  green:      "#5cb85c", lightgreen: "#8bc34a", red:        "#d9534f",
  blue:       "#428bca", orange:     "#f0ad4e", purple:     "#9B479F",
  pink:       "#e91e8c", cadetblue:  "#436978", darkgreen:  "#2e7d32",
  darkred:    "#a23336", darkpurple: "#5B396B",
};

export const PATHS = {
  locais:   "./data/locais.json",
  campus:   "./data/campus.geojson",
  overpass: "./data/overpass-cache.json",
  eventos:  "./data/eventos.json",
};
