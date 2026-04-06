# Ellipse Algorithm C

## Purpose

`alg-C` is the most specialized ellipse-fitting path in the repository's offline comparison tooling.

It is used by [`tools/gen_ellipses.js`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L512) to build one fitted ellipse from a set of alerted settlement points, with extra preprocessing intended to:

- focus on the main spatial cluster
- fit against the outer boundary rather than every point
- avoid coastline-adjacent boundary points that can distort the result for Israel's west edge

The implementation lives in [`tools/lib/ellipse-algorithms.js`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L952).

## Entry Point

The main function is [`fitAlgC(alertedPoints, options)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L952).

`alertedPoints` is an array of objects with:

- `lat`
- `lng`
- optionally `name` or other metadata, though `alg-C` only depends on coordinates

The function returns:

- `projection`
- `clusteredPoints`
- `boundaryPoints`
- `filteredBoundaryPoints`
- `candidate`
- `metrics`

The `candidate` is either:

- a projected-space ellipse with `centerX`, `centerY`, `semiMajor`, `semiMinor`, `angle`
- or a raw-degree ellipse returned from OpenCV with `centerLat`, `centerLng`, `widthDegrees`, `heightDegrees`, `angleDegrees`

## Algorithm Pipeline

`alg-C` runs in four stages.

### 1. Local projection

The input lat/lng points are first mapped into a simple local meters-based projection by [`buildProjection(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L92).

This projection:

- uses the average input latitude and longitude as the local origin
- converts latitude and longitude deltas into approximate meters
- keeps the geometry simple for clustering and distance checks

This is not Web Mercator and not Leaflet CRS math. It is a local linear approximation centered on the current input points.

### 2. Main-cluster detection

The projected points are reduced to the dominant cluster by [`detectMainCluster(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L252).

This step behaves like a simple DBSCAN-style density clustering pass:

- two points are neighbors when their squared distance is within `clusterEpsMeters^2`
- a point is a core point when it has at least `clusterMinSamples` neighbors
- connected core neighborhoods are expanded with breadth-first search
- the largest cluster is retained

Current defaults from [`ALG_C_DEFAULT_OPTIONS`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L45):

- `clusterEpsMeters: 10000`
- `clusterMinSamples: 10`

If the surviving cluster is too small, `alg-C` skips the later preprocessing steps and fits directly from that reduced point set.

### 3. Boundary extraction and coastline filtering

The outer shape of the cluster is estimated by [`buildAlphaShapeBoundaryPoints(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L302).

This step:

- converts the clustered points into `[lng, lat]` pairs
- runs the `alpha-shape` npm package
- measures each clustered point's distance to the alpha-shape edges
- keeps only points close to the derived boundary

If alpha-shape produces no usable edges, the code falls back to a convex hull.

Current defaults:

- `alpha: 0.1`
- `boundaryThresholdDegrees: 0.03`
- `minBoundaryPoints: 6`

The boundary points are then filtered against a precomputed Mediterranean coastline file by [`filterPointsAwayFromCoast(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L337).

That coastline data comes from:

- [`web/israel_mediterranean_coast_0.5km.csv`](/home/tomer/projects/oref-map/web/israel_mediterranean_coast_0.5km.csv)

The filter:

- loads the coastline once and caches it in memory
- projects coastline samples into the same local meter space
- computes the nearest coastline-point distance for each boundary point
- drops boundary points whose nearest coastline distance is at or below `coastMinDistanceMeters`

Current default:

- `coastMinDistanceMeters: 4000`

If coastline rejection removes too many points, `alg-C` falls back to the unfiltered boundary set.

### 4. Ellipse fit

The final fit is performed by [`fitOpenCvEllipseFromBoundary(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L412).

There are two paths.

#### OpenCV path

If there are at least 5 boundary points and each point still has its original source lat/lng, the function:

1. builds a small inline Node script
2. imports `@techstark/opencv-js`
3. passes the boundary points to that script over stdin
4. creates an OpenCV `Mat`
5. calls `cv.fitEllipse(mat)`
6. parses the JSON result back in the parent process

The output is returned in raw latitude/longitude degree space as:

- `centerLat`
- `centerLng`
- `widthDegrees`
- `heightDegrees`
- `angleDegrees`

This is why `gen_ellipses.js` has special handling for `result.coordinateSpace === 'raw-degrees'` in [`buildRenderableGeometry(...)`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L86).

#### Approximation fallback

If OpenCV cannot be used because there are too few points or the points do not carry source coordinates, the code falls back to [`fitProjectedEllipseFromBoundaryApprox(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L353).

That approximation:

- computes the centroid
- estimates orientation from the covariance matrix
- measures extents in the rotated basis
- pads the semi-axes
- enforces minimum sizes and a minimum minor/major ratio

This fallback is deterministic and fully local to the JS codebase. It does not use OpenCV.

## OpenCV Library

The package used by `alg-C` is:

- `@techstark/opencv-js`

It is declared in [`package.json`](/home/tomer/projects/oref-map/package.json#L12).

This is a normal npm dependency from the application's point of view:

- it is installed with npm
- it is imported from JavaScript
- it exposes OpenCV APIs to JS code

But it should not be thought of as a handwritten pure-JavaScript geometry library.

Instead, it is an OpenCV.js distribution, which means the OpenCV implementation is compiled for JavaScript environments and exposed through a JS loader/runtime. In practice:

- the repository code writes ordinary Node ESM
- the heavy ellipse fit comes from OpenCV's compiled implementation
- Node is not linking directly to a native `.node` addon here

The import used by `alg-C` is embedded in the child-process script inside [`fitOpenCvEllipseFromBoundary(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L428).

## Why `alg-C` Spawns a Child Node Process

The OpenCV fit is not called directly in the parent process. Instead, [`execFileSync(...)`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L448) starts a fresh Node process and executes a short inline module.

That design gives the implementation a few practical properties:

- OpenCV initialization is isolated to the child process
- the input and output boundary are simple JSON
- the parent process does not need to keep OpenCV loaded for the entire run
- the code can handle the package's different initialization forms in one place

The child script supports several `@techstark/opencv-js` loading behaviors:

- direct module object
- promise-returning module
- runtime-initialized module with `onRuntimeInitialized`

## How `gen_ellipses.js` Uses `alg-C`

The offline comparison tool [`tools/gen_ellipses.js`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L1) imports `fitAlgC` from the shared algorithm module and calls it in [`main()`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L493).

The usage flow is:

1. load the input location names from a JSON file
2. resolve each name to coordinates from `web/oref_points.json`
3. call `fitAlgC(alertedPoints)`
4. convert the returned candidate into renderable Leaflet geometry
5. render the result alongside `alg-basic`, `alg-A`, and `alg-B`

For `alg-C`, the tool records these metrics in the HTML popup via [`buildMetricLines(...)`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L246):

- `clusteredCount`
- `boundaryCount`
- `coastRejectedCount`
- `minCoastDistanceMeters`

The actual conversion to map geometry happens in [`buildRenderableGeometry(...)`](/home/tomer/projects/oref-map/tools/gen_ellipses.js#L79).

There are two render cases:

- if the candidate is in projected meters, build ellipse samples in projected space and unproject them
- if the candidate is in raw degrees, build raw-degree ellipse samples and separately estimate the axes in meters for display

## Tuning Parameters

The current defaults are defined in [`ALG_C_DEFAULT_OPTIONS`](/home/tomer/projects/oref-map/tools/lib/ellipse-algorithms.js#L45).

- `clusterEpsMeters`: neighborhood radius for the cluster detector
- `clusterMinSamples`: minimum neighbor count for a core point
- `alpha`: alpha-shape aggressiveness
- `boundaryThresholdDegrees`: how close a point must be to the alpha-shape boundary to count as a boundary point
- `coastMinDistanceMeters`: exclusion threshold for coastline-adjacent boundary points
- `minBoundaryPoints`: minimum count needed for boundary-based fitting
- `minSemiMajorMeters`: lower bound used by the approximation fallback
- `minSemiMinorMeters`: lower bound used by the approximation fallback
- `majorPaddingMeters`: extra major-axis padding in the approximation fallback
- `minorPaddingMeters`: extra minor-axis padding in the approximation fallback
- `minMinorRatio`: lower bound on ellipse thickness in the approximation fallback

## Limitations

`alg-C` is a pragmatic fitting pipeline, not a mathematically exact enclosure or probability model.

Known characteristics:

- the cluster detection can discard small detached groups by design
- the alpha-shape stage depends on lat/lng degree geometry, not meters
- the coastline filter uses point-to-point nearest distance, not point-to-segment coastline distance
- the OpenCV fit works in raw degree space, while earlier preprocessing works in local projected meters
- the fallback approximation is a padded oriented-bounding fit, not an OpenCV ellipse fit

These tradeoffs are acceptable for the comparison tool, where the goal is to generate visually plausible regional ellipses rather than formally optimal geometry.
