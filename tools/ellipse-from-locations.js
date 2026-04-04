#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OREF_POINTS_PATH = path.join(ROOT_DIR, 'web', 'oref_points.json');
const EARTH_RADIUS_METERS = 6378137;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function radToDeg(value) {
  return (value * 180) / Math.PI;
}

function projectEllipsePoint(point) {
  const lat = Math.max(Math.min(point.lat, 85.0511287798), -85.0511287798);
  return {
    x: EARTH_RADIUS_METERS * degToRad(point.lng),
    y: EARTH_RADIUS_METERS * Math.log(Math.tan((Math.PI / 4) + (degToRad(lat) / 2))),
    lat: point.lat,
    lng: point.lng,
  };
}

function unprojectEllipsePoint(point) {
  return {
    lat: radToDeg((2 * Math.atan(Math.exp(point.y / EARTH_RADIUS_METERS))) - (Math.PI / 2)),
    lng: radToDeg(point.x / EARTH_RADIUS_METERS),
  };
}

function normalizeVector(vector, fallback) {
  const length = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y));
  if (length < 1e-12) return fallback;
  return { x: vector.x / length, y: vector.y / length };
}

function buildEllipseGeometry(points) {
  if (!points.length) return null;

  const projectedPoints = points.map(projectEllipsePoint);
  if (projectedPoints.length === 1) {
    return {
      type: 'circle',
      center: points[0],
      radiusMeters: 700,
    };
  }

  let centerX = 0;
  let centerY = 0;
  for (const point of projectedPoints) {
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= projectedPoints.length;
  centerY /= projectedPoints.length;

  let majorAxis;
  if (projectedPoints.length === 2) {
    majorAxis = normalizeVector({
      x: projectedPoints[1].x - projectedPoints[0].x,
      y: projectedPoints[1].y - projectedPoints[0].y,
    }, { x: 1, y: 0 });
  } else {
    let covXX = 0;
    let covXY = 0;
    let covYY = 0;
    for (const point of projectedPoints) {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      covXX += dx * dx;
      covXY += dx * dy;
      covYY += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
    majorAxis = { x: Math.cos(angle), y: Math.sin(angle) };
  }

  majorAxis = normalizeVector(majorAxis, { x: 1, y: 0 });
  const minorAxis = { x: -majorAxis.y, y: majorAxis.x };

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const point of projectedPoints) {
    const offsetX = point.x - centerX;
    const offsetY = point.y - centerY;
    const u = (offsetX * majorAxis.x) + (offsetY * majorAxis.y);
    const v = (offsetX * minorAxis.x) + (offsetY * minorAxis.y);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  let semiMajor = Math.max((maxU - minU) / 2, 450);
  let semiMinor = Math.max((maxV - minV) / 2, 250);
  semiMajor += 350;
  semiMinor = Math.max(semiMinor + 250, semiMajor * 0.32);

  const offsetU = (minU + maxU) / 2;
  const offsetV = (minV + maxV) / 2;
  const ellipseCenter = {
    x: centerX + (majorAxis.x * offsetU) + (minorAxis.x * offsetV),
    y: centerY + (majorAxis.y * offsetU) + (minorAxis.y * offsetV),
  };

  return {
    type: 'ellipse',
    center: unprojectEllipsePoint(ellipseCenter),
    centerProjected: ellipseCenter,
    majorAxis,
    minorAxis,
    semiMajor,
    semiMinor,
  };
}

function readInputArgument(rawArg) {
  if (!rawArg) {
    fail('Usage: node tools/ellipse-from-locations.js \'[\"ירושלים - מערב\", \"בית שמש\"]\'\n   or: node tools/ellipse-from-locations.js --file /path/to/locations.json');
  }

  if (rawArg === '--file') return null;

  try {
    return JSON.parse(rawArg);
  } catch (error) {
    fail('Failed to parse inline JSON array: ' + error.message);
  }
}

function readInputFile(filePath) {
  const text = fs.readFileSync(path.resolve(filePath), 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('Failed to parse JSON file ' + filePath + ': ' + error.message);
  }
}

function ensureNameArray(value) {
  if (!Array.isArray(value)) {
    fail('Input must be a JSON array of location names.');
  }
  const names = value.map((entry) => String(entry));
  if (!names.length) {
    fail('Input array is empty.');
  }
  return names;
}

function resolvePoints(names, allPoints) {
  const missing = [];
  const points = [];

  for (const name of names) {
    const coords = allPoints[name];
    if (!coords || !Array.isArray(coords) || coords.length < 2) {
      missing.push(name);
      continue;
    }
    points.push({
      name,
      lat: coords[0],
      lng: coords[1],
    });
  }

  if (missing.length) {
    fail('Missing locations in web/oref_points.json: ' + missing.join(', '));
  }

  return points;
}

function main() {
  const args = process.argv.slice(2);
  let names;

  if (args[0] === '--file') {
    if (!args[1]) fail('Missing file path after --file');
    names = ensureNameArray(readInputFile(args[1]));
  } else {
    names = ensureNameArray(readInputArgument(args[0]));
  }

  const allPoints = JSON.parse(fs.readFileSync(OREF_POINTS_PATH, 'utf8'));
  const points = resolvePoints(names, allPoints);
  const geometry = buildEllipseGeometry(points);

  if (!geometry) fail('Failed to build geometry.');

  if (geometry.type === 'circle') {
    console.log(JSON.stringify({
      type: 'circle',
      pointCount: points.length,
      center: geometry.center,
      radiusMeters: geometry.radiusMeters,
      diameterMeters: geometry.radiusMeters * 2,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    type: geometry.type,
    pointCount: points.length,
    center: geometry.center,
    semiMajorMeters: geometry.semiMajor,
    semiMinorMeters: geometry.semiMinor,
    majorAxisLengthMeters: geometry.semiMajor * 2,
    minorAxisLengthMeters: geometry.semiMinor * 2,
    majorAxisBearingDegrees: (radToDeg(Math.atan2(geometry.majorAxis.x, geometry.majorAxis.y)) + 360) % 360,
  }, null, 2));
}

main();
